# ADR 0006 — One storage conformance suite, runner-injected, shipped as `@xtandard/kit/storage/testing`

**Status:** Accepted

---

## Context

Each product has its own `test/storage-contract.ts`, and their case sets differ (inventory §6 of
storage.md). The products run their suites under vitest (`vp test`) and under `bun test`, for
`bun:sqlite`. `bun test` rewrites `vitest` imports only for source files in the repo, so it cannot be
relied on for a published package. Live backends are gated inconsistently: some suites check whether
an environment variable is set, others probe a connection. RedisJSON never runs in CI for four
products.

## Decision

- `runStorageConformance(name, make, { t: { describe, test, expect }, capabilities, keyRoot, timeout })`
  is exported from `@xtandard/kit/storage/testing`. The **test API is injected**, so the suite works
  under vitest, `bun:test` and anything else with the same shape.
- The cases are the union of all copies, plus the new regression cases listed in PLAN §5.
- Products add their own suites (claimDue, event log, counters) next to it.
- Live backends are gated **only** by environment variables: `REDIS_URL`, `REDIS_JSON_URL`,
  `MONGO_URL`, `POSTGRES_URL`, `MYSQL_URL`.
- The kit's reusable CI workflow starts `redis:8`, which has JSON built in, alongside mongo, postgres
  and mysql.

## Consequences

- A storage fix is one change plus one new case in the kit. Every product's CI then exercises it
  against its own wrapped drivers.
