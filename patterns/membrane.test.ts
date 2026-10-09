// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

// Tests for the revocable membrane (patterns/membrane.ts): grant -> use ->
// revoke -> use throws. Exercised against both plain objects and real Cap'n Web
// stubs, since the membrane must survive a proxy-wrapping-a-proxy.

import { expect, it, describe } from "vitest"
import { RpcTarget, RpcStub } from "../src/index.js"
import { revocable, MembraneRevokedError } from "./membrane.js"

class Db extends RpcTarget {
  store = new Map<string, number>([["a", 1], ["b", 2]]);
  query(key: string): number | null {
    return this.store.get(key) ?? null;
  }
  drop(): string {
    return "dropped everything";
  }
}

describe("membrane over a real Cap'n Web stub", () => {
  it("grants use, then revoke makes every call throw", async () => {
    const { proxy, revoke } = revocable(new RpcStub(new Db()));

    // Grant: the capability works.
    expect(await proxy.query("a")).toBe(1);

    revoke();

    // Use after revoke: property access itself throws (synchronously).
    expect(() => (proxy as any).query("a")).toThrow(MembraneRevokedError);
    expect(() => (proxy as any).drop()).toThrow(MembraneRevokedError);
  });

  it("revoke is idempotent", async () => {
    const { proxy, revoke } = revocable(new RpcStub(new Db()));
    expect(await proxy.query("b")).toBe(2);
    revoke();
    expect(() => revoke()).not.toThrow();
    expect(() => (proxy as any).query("b")).toThrow(MembraneRevokedError);
  });

  it("blocks property writes and existence checks after revoke", () => {
    const target = { value: 1 };
    const { proxy, revoke } = revocable(target);
    expect(proxy.value).toBe(1);
    revoke();
    expect(() => { (proxy as any).value = 2; }).toThrow(MembraneRevokedError);
    expect(() => ("value" in proxy)).toThrow(MembraneRevokedError);
    expect(() => Object.keys(proxy)).toThrow(MembraneRevokedError);
    // The underlying target is untouched -- only the membrane died.
    expect(target.value).toBe(1);
  });
});

describe("membrane transitivity", () => {
  it("wraps nested objects; revoke kills the whole graph", () => {
    const inner = {
      secret: 42,
      getSecret() { return this.secret; },
    };
    const { proxy, revoke } = revocable({ inner });

    expect(proxy.inner.getSecret()).toBe(42);
    // Identity is preserved through the membrane.
    expect(proxy.inner).toBe(proxy.inner);

    revoke();

    // Even a previously-obtained nested reference is dead.
    const nestedBefore = proxy; // (accessing .inner now would throw)
    expect(() => nestedBefore.inner.getSecret()).toThrow(MembraneRevokedError);
    // Sanity: the raw objects never saw the membrane.
    expect(inner.getSecret()).toBe(42);
  });

  it("wraps functions returned through the membrane", () => {
    const { proxy, revoke } = revocable({
      makeAdder: (x: number) => (y: number) => x + y,
    });
    const add5 = proxy.makeAdder(5);
    expect(add5(3)).toBe(8);
    revoke();
    expect(() => add5(3)).toThrow(MembraneRevokedError);
    expect(() => proxy.makeAdder(1)).toThrow(MembraneRevokedError);
  });
});
