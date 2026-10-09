// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Caretaker: attenuate a capability to least privilege.
 *
 * `attenuate()` wraps a target (a Cap'n Web stub or a plain object) so that only
 * the methods named in `policy.allow` can be invoked. Anything else throws
 * `CaretakerDeniedError` at property-access time -- the denied method is never
 * even looked up on the target.
 *
 * An optional sliding-window rate limit throws `CaretakerRateLimitError` once
 * `calls` invocations have been made within the last `perMs` milliseconds.
 * The window slides: old calls age out, so the limit is "at most N calls per
 * M ms", not a fixed bucket.
 *
 * Notes:
 * - Symbol-keyed properties (`Symbol.dispose`, `Symbol.toStringTag`, ...) always
 *   pass through: they are JS meta-protocol, not authority.
 * - Attenuation applies to the immediate interface. Results returned through the
 *   caretaker are *not* re-wrapped (unlike the membrane in `./membrane.js`),
 *   which keeps `await` on RPC results working naturally.
 * - The rate limiter counts invocations (function calls through the proxy).
 */

/** Thrown when code touches a method the caretaker policy does not allow. */
export class CaretakerDeniedError extends Error {
  readonly deniedMethod: string;
  constructor(deniedMethod: string) {
    super(`caretaker: method "${deniedMethod}" is not allowed by this capability's policy`);
    this.name = "CaretakerDeniedError";
    this.deniedMethod = deniedMethod;
  }
}

/** Thrown when the caretaker's rate limit trips. */
export class CaretakerRateLimitError extends Error {
  readonly calls: number;
  readonly perMs: number;
  constructor(calls: number, perMs: number) {
    super(`caretaker: rate limit exceeded (more than ${calls} calls per ${perMs}ms)`);
    this.name = "CaretakerRateLimitError";
    this.calls = calls;
    this.perMs = perMs;
  }
}

export interface AttenuationPolicy<T extends object> {
  /** The only methods (string-keyed properties) reachable through the wrapper. */
  allow: (keyof T)[];
  /** Optional sliding-window rate limit on invocations. */
  rateLimit?: { calls: number; perMs: number };
}

/**
 * Attenuates `target` to the given policy.
 *
 * @returns a proxy of the same type as `target` exposing only `policy.allow`.
 */
export function attenuate<T extends object>(target: T, policy: AttenuationPolicy<T>): T {
  const allow = new Set<PropertyKey>(policy.allow as PropertyKey[]);
  // Timestamps (Date.now()) of recent invocations, oldest first.
  const recentCalls: number[] = [];

  function checkRateLimit(): void {
    const rl = policy.rateLimit;
    if (rl === undefined) {
      return;
    }
    const now = Date.now();
    while (recentCalls.length > 0 && recentCalls[0]! <= now - rl.perMs) {
      recentCalls.shift();
    }
    if (recentCalls.length >= rl.calls) {
      throw new CaretakerRateLimitError(rl.calls, rl.perMs);
    }
    recentCalls.push(now);
  }

  function isAllowed(key: PropertyKey): boolean {
    // Symbols are JS meta-protocol, not authority: always forward.
    return typeof key !== "string" || allow.has(key);
  }

  const handler: ProxyHandler<object> = {
    get(t, p) {
      if (!isAllowed(p)) {
        throw new CaretakerDeniedError(String(p));
      }
      const value = Reflect.get(t as any, p);
      if (typeof value === "function") {
        return function (this: unknown, ...args: unknown[]) {
          checkRateLimit();
          return Reflect.apply(value, t, args);
        };
      }
      return value;
    },
    set(t, p, v) {
      if (!isAllowed(p)) {
        throw new CaretakerDeniedError(String(p));
      }
      return Reflect.set(t as any, p, v);
    },
    has(t, p) {
      if (!isAllowed(p)) {
        throw new CaretakerDeniedError(String(p));
      }
      return Reflect.has(t, p);
    },
    apply(t, thisArg, args) {
      checkRateLimit();
      return Reflect.apply(t as any, t, args);
    },
  };

  return new Proxy(target, handler) as T;
}
