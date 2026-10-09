# SPEC: Cap'n Web Capability Patterns Library

**Fork:** mfspxz/capnweb · **Branch:** lucidota · **Budget:** 50 iterations

## Goal

Reference implementations of object-capability patterns for agent systems, in TypeScript,
using Cap'n Web's RPC. When an agent grants authority to another agent, these are the
patterns that keep it safe.

## Non-goals

- Modifying Cap'n Web core. Patterns only.
- Rust bindings (that's a separate spec).

## Background

Object capabilities: an unforgeable reference. You can't guess it, can't fake it —
you can only use what you were given. Three patterns cover 95% of agent delegation:

1. **Membrane** — wrap an object graph in a revocable membrane. Revoke once, all
   access through the membrane dies. (Agent offboarding, session end.)
2. **Caretaker** — attenuate authority. Grant a subset: read-only, rate-limited,
   scoped to certain methods. (Least-privilege delegation.)
3. **Receipt wrapper** — log every call through the capability. (Audit trail.)

## Deliverables

### 1. `patterns/membrane.ts`

```ts
// Wraps a Cap'n Web stub (or object graph) in a revocable membrane.
export function revocable<T extends object>(target: T): { proxy: T; revoke(): void }
// After revoke(), every method call through proxy throws.
```

- Must handle nested objects (membrane is transitive).
- Test: grant → use → revoke → use throws.

### 2. `patterns/caretaker.ts`

```ts
// Attenuates a stub: only allowed methods, optional rate limit.
export function attenuate<T extends object>(target: T, policy: {
  allow: (keyof T)[];
  rateLimit?: { calls: number; perMs: number };
}): T
```

- Test: allowed method works, denied method throws, rate limit trips.

### 3. `patterns/receipt.ts`

```ts
// Wraps a stub; every call appends {method, args, ts} to the provided sink.
export function withReceipts<T extends object>(target: T, sink: (r: Receipt) => void): T
```

- Test: calls are logged with method name and timestamp.

### 4. Tests

- `patterns/*.test.ts` — one test file per pattern, using the repo's test runner.
- All tests must pass: `pnpm test` (or the repo's equivalent).

### 5. `PATTERNS.md`

One page: which pattern for which delegation scenario, with a worked example
(an agent granting a sub-agent read-only DB access for 10 minutes).

## Acceptance criteria

- [ ] Three pattern modules, typed, documented
- [ ] Tests green for all three (revoke actually revokes, attenuate actually denies, receipts actually log)
- [ ] `PATTERNS.md` with the worked example
- [ ] No changes to Cap'n Web core

## Constraints

- TypeScript only. Follow the repo's style (check existing code).
- Never `reset`/`force-push`. Commit on the `lucidota` branch only.
