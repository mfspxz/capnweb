// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Revocable membranes for object capabilities.
 *
 * A membrane wraps an object graph (a Cap'n Web stub, a plain object, or anything
 * in between) in a proxy that forwards everything -- until `revoke()` is called.
 * After revocation, *every* operation through the membrane throws
 * `MembraneRevokedError`: method calls, property reads/writes, `in` checks,
 * even `Object.keys()`.
 *
 * The membrane is **transitive**: objects (and functions) obtained through the
 * membrane are themselves wrapped, so there is no way to smuggle an unwrapped
 * reference out. Wrapped identities are memoized, so `proxy.x === proxy.x`.
 *
 * Revocation is terminal and idempotent. On revoke, the membrane also makes a
 * best-effort attempt to dispose the underlying target (e.g. an `RpcStub`'s
 * `[Symbol.dispose]`), releasing server-side resources. Disposal failure never
 * blocks revocation.
 *
 * `this`-binding is deliberate: methods are always invoked with the object they
 * were read from as `this`, ignoring any call-time receiver (e.g.
 * `m.call(other)`). This is standard membrane semantics -- it keeps `this`
 * working for ordinary method calls while preventing `this`-confusion attacks
 * from smuggling an unwrapped receiver into the target.
 *
 * In-flight calls that started before `revoke()` are not cancelled -- the
 * membrane guards *new* access, which is the standard membrane semantic.
 */

/** Thrown by every membrane trap after `revoke()` has been called. */
export class MembraneRevokedError extends Error {
  constructor() {
    super("membrane revoked: this capability is no longer usable");
    this.name = "MembraneRevokedError";
  }
}

interface MembraneState {
  revoked: boolean;
  /** Memoizes wrapped identities so `proxy.x === proxy.x`. */
  memo: WeakMap<object, unknown>;
}

function ensureLive(state: MembraneState): void {
  if (state.revoked) {
    throw new MembraneRevokedError();
  }
}

function isWrappable(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function wrapInMembrane(value: object, state: MembraneState, thisArg: unknown): unknown {
  const existing = state.memo.get(value);
  if (existing !== undefined) {
    return existing;
  }

  const handler: ProxyHandler<object> = {
    get(t, p) {
      ensureLive(state);
      // Bind methods to the object they were read from so `this` keeps working,
      // including for RpcStub/RpcPromise internals.
      return wrapValue(Reflect.get(t as any, p), state, t);
    },
    set(t, p, v) {
      ensureLive(state);
      return Reflect.set(t as any, p, v);
    },
    has(t, p) {
      ensureLive(state);
      return Reflect.has(t, p);
    },
    deleteProperty(t, p) {
      ensureLive(state);
      return Reflect.deleteProperty(t, p);
    },
    defineProperty(t, p, attributes) {
      ensureLive(state);
      return Reflect.defineProperty(t, p, attributes);
    },
    getOwnPropertyDescriptor(t, p) {
      ensureLive(state);
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
    ownKeys(t) {
      ensureLive(state);
      return Reflect.ownKeys(t);
    },
    apply(t, _thisArg, args) {
      ensureLive(state);
      const receiver = thisArg === undefined ? t : thisArg;
      return wrapValue(Reflect.apply(t as any, receiver, args), state, undefined);
    },
    construct(t, args, newTarget) {
      ensureLive(state);
      return wrapValue(Reflect.construct(t as any, args, newTarget), state, undefined) as object;
    },
  };

  const proxy = new Proxy(value, handler);
  state.memo.set(value, proxy);
  return proxy;
}

function wrapValue(value: unknown, state: MembraneState, thisArg: unknown): unknown {
  if (!isWrappable(value)) {
    return value;
  }
  return wrapInMembrane(value, state, thisArg);
}

/**
 * Wraps `target` in a revocable membrane.
 *
 * @returns `{ proxy, revoke }`. `proxy` has the same type as `target` and
 * forwards everything until `revoke()` is called, after which every operation
 * through `proxy` (including through objects obtained from it earlier) throws
 * `MembraneRevokedError`.
 */
export function revocable<T extends object>(target: T): { proxy: T; revoke(): void } {
  const state: MembraneState = { revoked: false, memo: new WeakMap() };
  const proxy = wrapInMembrane(target, state, undefined) as T;

  const revoke = (): void => {
    if (state.revoked) {
      return;
    }
    state.revoked = true;
    // Best-effort: release the underlying capability (e.g. dispose an RpcStub
    // so the server can free the exported reference). Never blocks revocation.
    try {
      const dispose = (target as any)?.[Symbol.dispose];
      if (typeof dispose === "function") {
        dispose.call(target);
      }
    } catch {
      // ignore -- revocation already took effect
    }
  };

  return { proxy, revoke };
}
