// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

// Tests for the caretaker (patterns/caretaker.ts): allowed methods work, denied
// methods throw at access time, and the sliding-window rate limit trips.

import { expect, it, describe } from "vitest"
import { RpcTarget, RpcStub } from "../src/index.js"
import { attenuate, CaretakerDeniedError, CaretakerRateLimitError } from "./caretaker.js"

class Db extends RpcTarget {
  query(sql: string): string {
    return `rows:${sql}`;
  }
  drop(): string {
    return "dropped everything";
  }
}

function readOnlyDb() {
  return attenuate(new RpcStub(new Db()), { allow: ["query"] });
}

describe("caretaker", () => {
  it("allows listed methods through a real stub", async () => {
    const db = readOnlyDb();
    expect(await db.query("select 1")).toBe("rows:select 1");
  });

  it("denies unlisted methods at access time", () => {
    const db = readOnlyDb();
    // The denial happens on property access -- the forbidden method is never
    // even looked up on the target.
    expect(() => (db as any).drop()).toThrow(CaretakerDeniedError);
    expect(() => (db as any).drop()).toThrow(/"drop" is not allowed/);
  });

  it("denies existence checks for unlisted methods", () => {
    const db = readOnlyDb();
    expect(() => ("drop" in db)).toThrow(CaretakerDeniedError);
    expect("query" in db).toBe(true);
  });

  it("lets symbol-keyed meta-protocol through", async () => {
    const raw = new RpcStub(new Db());
    const db = readOnlyDb();
    // Symbol-keyed meta-protocol must behave identically to the raw stub --
    // the caretaker changes nothing about it. (Note: even the raw RpcStub
    // reports "[object Function]" here; only its toString() says RpcStub --
    // and toString itself is a string-keyed method, correctly denied.)
    expect(Object.prototype.toString.call(db)).toBe(Object.prototype.toString.call(raw));
    expect(typeof (db as any)[Symbol.dispose]).toBe(typeof (raw as any)[Symbol.dispose]);
  });

  it("trips the sliding-window rate limit", async () => {
    const db = attenuate(new RpcStub(new Db()), {
      allow: ["query"],
      rateLimit: { calls: 2, perMs: 60_000 },
    });
    expect(await db.query("one")).toBe("rows:one");
    expect(await db.query("two")).toBe("rows:two");
    // Third call inside the window: the limiter throws synchronously, before
    // any RPC is issued.
    expect(() => db.query("three")).toThrow(CaretakerRateLimitError);
    expect(() => db.query("three")).toThrow(/more than 2 calls per 60000ms/);
  });

  it("lets the window slide", async () => {
    const db = attenuate(new RpcStub(new Db()), {
      allow: ["query"],
      rateLimit: { calls: 1, perMs: 50 },
    });
    expect(await db.query("one")).toBe("rows:one");
    expect(() => db.query("two")).toThrow(CaretakerRateLimitError);
    await new Promise((r) => setTimeout(r, 60));
    // The first call aged out of the window: allowed again.
    expect(await db.query("three")).toBe("rows:three");
  });

  it("works on plain objects too", () => {
    const calc = attenuate(
      { add: (a: number, b: number) => a + b, mul: (a: number, b: number) => a * b },
      { allow: ["add"] },
    );
    expect(calc.add(2, 3)).toBe(5);
    expect(() => (calc as any).mul(2, 3)).toThrow(CaretakerDeniedError);
  });
});
