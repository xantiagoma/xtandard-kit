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

## 2026-11-21 — AUTH_MODE hotfixes merged; phase 3 workers started

- Reviewed and squash-merged the AUTH_MODE fail-open hotfixes: webhooks#15, flags#23 (also the
  standalone image), audit#25, links#19. CI was green on all four. t1r was asked for patch releases
  and image rebuilds.
- Created the public repo xantiagoma/xtandard-kit (MIT). `main` CI is green (reusable `ci.yml` via
  `kit-ci.yml`).
- Started three build workers, each in its own worktree with disjoint files:
  - `kit-build-storage` (t6z);
  - `kit-build-server` (t70);
  - `kit-build-ui` (t71): UI kit, build tooling, site and workflows.

  Briefs live in the session scratchpad (BUILD-\*.md).

## 2026-11-21: phase 3 areas landing; webhooks pilot started

- Merged after review, with CI green each time:
  - #1 auth, authz, hooks, util, tokens (verifies each product's frozen portal tokens);
  - #2 storage contract, memory/file/unstorage/cf-kv, conformance suite, stored-data fixtures;
  - #3 UI kit + embed;
  - #4 server panel, plumbing, router, OpenAPI (`*TokenError` → 401 cross-bundle);
  - #5 SQL drivers + drizzle (MySQL emoji range-scan fix);
  - #6 build tooling, api-surface, UI e2e;
  - #8 mongodb + redis;
  - #9 adapters + CLI;
  - #10 MySQL PAD SPACE guard, `KeyCollisionError`, opt-in NO PAD collation;
  - #11 a comment-only change.
- Product bugs found while building, all shipping with the migration (t1r agreed):
  - MySQL indexed `LIKE` skips emoji keys;
  - unstorage `"123"` → `123`;
  - MySQL PAD SPACE trailing-space key collisions. The per-product check found audit, links and
    entitlements safe (`encodeURIComponent`); webhooks and flags reach storage through path params.
    Recorded in inventory §5 and ADR 0005 item 5.
- Lead-side changes on main: peers for build/site, `starlight-typedoc`, `esbuild`, `astro-mermaid`,
  `starlight-links-validator`. Workers must gate under bun 1.3.14 (`mise x`); local shells default to
  1.4.4.
- The storage worker is done (`docs/research/build-storage.md`).
- The server worker is doing a CLI follow-up: sqlite/libsql table defaults in the default registry.
- The UI worker is on the site tooling, docs site and reusable workflows.
- Started the webhooks migration **pilot** (t82) against a packed kit snapshot, to find kit API gaps
  before the first publish.
