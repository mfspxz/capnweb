<!-- Copyright (c) 2026 Cloudflare, Inc. -->
<!-- Licensed under the MIT license found in the LICENSE.txt file or at: -->
<!--     https://opensource.org/license/mit -->

# Capability Patterns for Agent Systems

Reference implementations of the three object-capability patterns that cover 95%
of agent delegation, built on Cap'n Web RPC. An unforgeable reference: you can't
guess it, can't fake it — you can only use what you were given.

| Pattern       | Module                  | Use when...                                                                       |
| ------------- | ----------------------- | --------------------------------------------------------------------------------- |
| **Membrane**  | `patterns/membrane.ts`  | The grant must die completely: agent offboarding, session end, task cancellation. |
| **Caretaker** | `patterns/caretaker.ts` | Least privilege: grant a subset of methods, optionally rate-limited.              |
| **Receipts**  | `patterns/receipt.ts`   | You need an audit trail of everything done through the capability.                |

Compose them: membrane on the outside (kills everything), caretaker in the middle
(shapes what's allowed), receipts on the inside (logs what happened).

```ts
const { proxy: sessionDb, revoke } = revocable(db);          // dies on revoke()
const readOnly = attenuate(sessionDb, { allow: ["query"] }); // only query()
const audited = withReceipts(readOnly, (r) => ledger.push(r)); // logged
```

## Worked example: read-only DB access for a sub-agent, 10 minutes

An orchestrator grants a sub-agent read-only database access. The grant must:

1. expose only `query` (not `drop`, not `migrate`),
2. allow at most 100 calls per minute,
3. log every call for audit,
4. die automatically after 10 minutes (or immediately on session end).

```ts
import { RpcStub } from "capnweb";
import { revocable } from "./patterns/membrane.js";
import { attenuate } from "./patterns/caretaker.js";
import { withReceipts, type Receipt } from "./patterns/receipt.js";

// The full database capability. NEVER handed out directly.
const db = new RpcStub(new Database());

// 1. Revocable: one call kills the entire grant, transitively.
const { proxy: sessionDb, revoke } = revocable(db);

// 2. Attenuated: read-only + rate-limited. `drop` throws on access.
const readOnly = attenuate(sessionDb, {
  allow: ["query"],
  rateLimit: { calls: 100, perMs: 60_000 },
});

// 3. Receipts: every call lands in the audit sink before it executes.
const receipts: Receipt[] = [];
const audited = withReceipts(readOnly, (r) => receipts.push(r));

// Hand `audited` to the sub-agent. It can query, nothing else.
subAgent.run({ db: audited });

// The grant expires after 10 minutes...
const timer = setTimeout(() => revoke(), 10 * 60 * 1000);

// ...or the moment the session ends, whichever comes first.
session.on("end", () => {
  clearTimeout(timer);
  revoke(); // every outstanding reference through the membrane now throws
});

// Later: the audit trail.
for (const r of receipts) {
  console.log(`${new Date(r.ts).toISOString()} ${r.method}(${JSON.stringify(r.args)})`);
}
```

Why this layering order: the membrane is outermost so revocation kills even the
receipt sink's view; the caretaker sits inside it so denied methods never reach
the target; receipts are innermost so the log records exactly the calls the
policy allowed.

## API notes

- `revocable(target)` returns `{ proxy, revoke }`. After `revoke()`, every trap
  throws `MembraneRevokedError`. Nested objects are wrapped transitively;
  revocation also best-effort disposes the target (e.g. an `RpcStub`).
- `attenuate(target, { allow, rateLimit? })` throws `CaretakerDeniedError` for
  unlisted methods (at property-access time) and `CaretakerRateLimitError` when
  the sliding window trips. Symbol-keyed meta-protocol always passes through.
- `withReceipts(target, sink)` appends `{ method, args, ts }` to `sink` before
  each invocation, including calls that later fail.
