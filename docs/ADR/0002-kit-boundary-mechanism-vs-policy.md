# ADR 0002 — Boundary: the kit owns mechanism, products own policy and data

**Status:** Accepted

---

## Context

The inventory (`docs/research/inventory.md`) found three kinds of difference between the five copies:
- name-only differences;
- parameter differences: action enums, default table names, token prefixes, readonly status;
- genuine product logic: delivery queue, event log, counters, routes, views.

Without a rule, the kit either absorbs product logic or leaves shared code behind.

## Decision

**Goes into the kit:**
- Code whose copies differ only by **names, enum lists, defaults or brand tokens**. Those differences
  become **explicit parameters or generics**.
- Code where one copy is a strict improvement of another. The best piece of each copy is combined
  with every fix (inventory §3).

**Stays in the product:**
- Code that encodes a product's domain: key layouts, route bodies, views, seed data, CLI commands, and
  the capabilities `claimDue`, `EventLogStorage` and `CounterStore`.
- For those, the kit provides **extension points**: driver write hooks, exported connection, codec
  and executor helpers, and extra conformance suites.

The kit has **no global "product config"**. Each factory takes its own options, so it can be tested in
isolation and no hidden state is shared between products loaded in one process.

## Consequences

- The products keep thin wrappers that pass their defaults (ADR 0003, ADR 0005).
- A capability moves into the kit only once a second product needs it and its interface is generic.
  en's `CounterStore` and wh's lease queue are the current candidates.
