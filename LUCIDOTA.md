# LUCIDOTA on Cap'n Web

We fork Cap'n Web as **the wire for organelle composition** — capability-secure,
schema-free, JavaScript-native RPC.

## Why we forked

Object capabilities are the right model for organelles. A capability is an unforgeable
reference: you can't guess it, you can't fake it, you can only use what you were given.
That's the membrane — the shell holds the reference, the organelle does the work,
nothing outside the grant can reach in.

Our doctrine: *MCP is the wire, not the organelle.* Cap'n Web is another wire —
and a better one for JS-native contexts (Workers, browser, edge). No schemas means
less friction. Human-readable means debuggable at 2am.

## What we're building

- **Capability-passing patterns for agent systems** — how organelles grant and
  attenuate authority to each other.
- **Rust bindings** — our stack is Rust-first; the wire should meet us there.
- **Receipt-carrying RPC** — every call wrapped in the proof-ledger envelope.

## Branches

- `main` — pure upstream mirror, auto-synced daily. Don't touch.
- `lucidota` — our direction. You're here.

## Road to total conversion

A capability-native organelle wire where every call is authorized, attenuated, and receipted.
