// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Receipt wrapper: audit every call made through a capability.
 *
 * `withReceipts()` wraps a target (a Cap'n Web stub or a plain object) so that
 * every method invocation appends a `Receipt` -- `{ method, args, ts }` -- to
 * the provided sink *before* the call is forwarded. Failed calls are still
 * recorded, which is exactly what an audit trail wants.
 *
 * The sink is yours: push into an array, append to a ledger, ship to a log
 * aggregator. The wrapper never inspects or retains the sink's contents.
 *
 * Notes:
 * - Only invocations are logged, not bare property reads.
 * - Results are returned unwrapped (like `./caretaker.js`), so `await` on RPC
 *   results works naturally.
 * - `ts` is `Date.now()` (Unix epoch milliseconds).
 */

/** One audited call through a receipt-wrapped capability. */
export interface Receipt {
  /** Name of the invoked method (or `"(call)"` for direct function calls). */
  method: string;
  /** Arguments the method was invoked with. */
  args: unknown[];
  /** Unix epoch milliseconds at invocation time. */
  ts: number;
}

/**
 * Wraps `target` so every method call appends a `Receipt` to `sink`.
 *
 * @returns a proxy of the same type as `target`.
 */
export function withReceipts<T extends object>(
  target: T,
  sink: (receipt: Receipt) => void,
): T {
  const handler: ProxyHandler<object> = {
    get(t, p) {
      const value = Reflect.get(t as any, p);
      if (typeof value === "function") {
        const method = typeof p === "string" ? p : String(p);
        return function (this: unknown, ...args: unknown[]) {
          sink({ method, args, ts: Date.now() });
          return Reflect.apply(value, t, args);
        };
      }
      return value;
    },
    apply(t, thisArg, args) {
      sink({ method: "(call)", args: args as unknown[], ts: Date.now() });
      return Reflect.apply(t as any, t, args);
    },
  };

  return new Proxy(target, handler) as T;
}
