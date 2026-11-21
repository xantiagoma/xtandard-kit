# Worklog — @xtandard/kit

## 2026-11-21 — Phase 1: inventory

- Normalised per-file diff matrix across the five product repos (`docs/research/inventory/data/`).
- Three read-only workers (storage, server, ui+tooling) wrote area sections; lead spot-checked key
  claims (wh index.html title unescaped, fl auth catch → 401, `isTransactional` unused everywhere, wh
  Redis PSUBSCRIBE unescaped, wh CLI unknown-driver fallback) and consolidated `docs/research/inventory.md`.
- Result: the five named storage bugs are fixed in all copies today; ~30 other fixes are stranded in
  one or two copies (inventory §3.2). Best piece per area differs by repo (en storage/router, li HTTP
  plumbing/embed, au ids/streaming, fl theme/scope-css).
- Next: phase 2 design (PLAN.md + ADRs).

## 2026-11-21 — Phase 2: design

- t1r approved the inventory and asked for an immediate AUTH_MODE fail-open hotfix in wh/fl/au/li.
  Worker `kit-hotfix-authmode` (t6r) is on it, with one PR per repo; the lead reviews and merges.
- Wrote PLAN.md and ADRs 0001–0010. Main choices:
  - one package with subpaths and optional peers;
  - mechanism goes in the kit, policy stays in the products;
  - product wrappers plus an api-surface gate;
  - driver extension points;
  - stored-data read-through, plus canonical CAS with a structural fallback;
  - a runner-injected conformance suite;
  - ZeroVer: products pin `^0.MINOR`, so kit patches flow to them;
  - the UI ships as compiled ESM with `@source`;
  - reusable workflows, but `npm publish` stays in each repo (trusted publishing);
  - behaviour differences become parameters, while fixes are applied everywhere.
- Researched trusted publishing with reusable workflows: npm validates the calling workflow, and
  publishing from inside a `workflow_call` is reported as fragile.

## 2026-11-21 — Phase 3 step 0: skeleton

- t1r approved the design, with two additions now in ADRs 0005, 0007 and 0009:
  - Docker images need a rebuild with `refresh-kit` to pick up a kit patch;
  - stored-data fixtures are permanent tests.
- Skeleton mirrors flags:
  - `scripts/subpaths.ts` is the single source of the 51 subpaths (exports, pack entries, stubs);
  - toolchain: vite-plus, tsconfig, husky, mise;
  - README with the ecosystem table, CLAUDE.md with the "how to add a fix once" note, CHANGELOG;
  - reusable `ci.yml` plus the kit's own `kit-ci.yml`.
- Local results: `check`, `test`, `vp pack` and `publint` are clean.
