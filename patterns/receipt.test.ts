// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

// Tests for the receipt wrapper (patterns/receipt.ts): every call through the
// capability appends { method, args, ts } to the sink, including failed calls.

import { expect, it, describe } from "vitest"
import { RpcTarget, RpcStub } from "../src/index.js"
import { withReceipts, type Receipt } from "./receipt.js"

class Db extends RpcTarget {
  query(sql: string): string {
    return `rows:${sql}`;
  }
  explode(): string {
    throw new Error("boom");
  }
}

describe("receipt wrapper", () => {
  it("logs method name, args, and timestamp for stub calls", async () => {
    const receipts: Receipt[] = [];
    const db = withReceipts(new RpcStub(new Db()), (r) => receipts.push(r));

    expect(await db.query("select 1")).toBe("rows:select 1");

    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.method).toBe("query");
    expect(receipts[0]!.args).toEqual(["select 1"]);
    expect(typeof receipts[0]!.ts).toBe("number");
    // Timestamp is a sane Unix-epoch-ms value (2026, not 1970, not far future).
    expect(receipts[0]!.ts).toBeGreaterThan(new Date("2026-01-01").getTime());
    expect(receipts[0]!.ts).toBeLessThanOrEqual(Date.now());
  });

  it("logs failed calls too", async () => {
    const receipts: Receipt[] = [];
    const db = withReceipts(new RpcStub(new Db()), (r) => receipts.push(r));

    await expect(db.explode()).rejects.toThrow("boom");

    // The audit trail records the attempt even though it failed.
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.method).toBe("explode");
    expect(receipts[0]!.args).toEqual([]);
  });

  it("logs in call order across multiple calls", async () => {
    const receipts: Receipt[] = [];
    const db = withReceipts(new RpcStub(new Db()), (r) => receipts.push(r));

    await db.query("a");
    await db.query("b");
    await db.query("c");

    expect(receipts.map((r) => r.args[0])).toEqual(["a", "b", "c"]);
    const ts = receipts.map((r) => r.ts);
    expect([...ts].sort((x, y) => x - y)).toEqual(ts);
  });

  it("forwards results untouched", async () => {
    const receipts: Receipt[] = [];
    const db = withReceipts(new RpcStub(new Db()), (r) => receipts.push(r));
    // The wrapper must not break `await` on RPC results.
    const result: string = await db.query("select 2");
    expect(result).toBe("rows:select 2");
    expect(receipts).toHaveLength(1);
  });

  it("composes: receipts + caretaker + membrane", async () => {
    const { revocable } = await import("./membrane.js");
    const { attenuate } = await import("./caretaker.js");

    const receipts: Receipt[] = [];
    const { proxy: sessionDb, revoke } = revocable(new RpcStub(new Db()));
    const readOnly = attenuate(sessionDb, { allow: ["query"] });
    const audited = withReceipts(readOnly, (r) => receipts.push(r));

    expect(await audited.query("select 9")).toBe("rows:select 9");
    expect(receipts.map((r) => r.method)).toEqual(["query"]);

    revoke();
    expect(() => (audited as any).query("nope")).toThrow();
  });
});
