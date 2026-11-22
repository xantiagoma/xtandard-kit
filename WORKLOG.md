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

## 2026-11-21: phase 3 done; READY TO PUBLISH

- Merged:
  - #12: the CLI passes sqlite/libsql table names;
  - #13: `pgKvTable` `keyCollation`, `RedisLike` sorted-set commands;
  - #14: site tooling, the kit docs site, reusable pages/docker/release-prepare workflows;
  - #15: conformance capabilities must be declared, `fakeRedis` exported. Both came from the pilot's
    feedback; #15 also found two kit suites that were silently skipping cases;
  - #16: release v0.1.0 (version, CHANGELOG, first-publish steps in docs/RELEASES.md).
- Pages is enabled (source: GitHub Actions). The site is live at
  https://me.xantiagoma.com/xtandard-kit/: API reference, guides, ADRs, ecosystem.
- On `main` at `e2dc9ad`: CI and Pages are green; `npm pack --dry-run` (0.1.0, 402 files, 654 kB)
  and publint are clean.
- All three build workers are done; their summaries are in `docs/research/build-{storage,server,ui}.md`.
  The webhooks pilot (t82) continues on kit 0.1.0.

## 2026-11-21: phase 4 under way (migrations against a local kit)

- 0.1.0 is built from `e2dc9ad` and waits on the owner's npm 2FA (t1r). v0.1.1 is prepared as draft
  PR #22; it is tagged only after t1r confirms 0.1.0 + trust.
- The migrations found these kit fixes and gaps, merged for 0.1.1:
  - #17: driver errors name the product subpath;
  - #18: file read-through aliasing (data loss in fl's default mode);
  - #19: Node 20.0–20.15 served the fallback page;
  - #20: `storageRegistryFrom`, `isMainModule(url)`, `validateKeySegment` `maxLength`;
  - #21: example runner `seed`, `demo` optional;
  - #23: `padSpaceKeys`, `SqliteExecutor.atomic`, `isDuplicateKey` bulk errors, `CanonicalInput`,
    tokens sign the validated claims.
- Migrations, each green locally and with no PR until the kit is on npm:
  - **webhooks:** net -5,181 LOC, 0 API removals;
  - **flags:** net -5,596, 0 removals;
  - **audit:** net -5,672, 0 removals; its event log sits on the kit internals;
  - **links** (t8r) and **entitlements** (t8w) are in progress.
- The shared tarball at `xtandard-kit-wt-pilot/pack` is re-packed at kit main `9a16c7f`.

## 2026-11-21: all five migrations green locally; waiting on the npm publish

- Migration branches `feat/kit-migration` (no PRs until the kit is on npm). Net LOC and API-surface
  removals:
  - webhooks: 394a449, -5.2k, 0 removed;
  - flags: 11a9fcd, -5.6k, 0 removed;
  - audit: f733f86, -5.7k, 0 removed;
  - links: c15bcce, -5.7k, 0 removed;
  - entitlements: a72b77a, -6.1k, 0 removed; adopted the kit router, OpenAPI identical.

  Each carries the kit's README and site ecosystem row.

- Kit fixes from the migrations for 0.1.1:
  - #24: a real libsql `Client` assigns again, late-bound clocks, `site/public`, the ClickHouse
    service;
  - #25: `parseArgs` keeps negative values;
  - #26: `SectionCard` a11y;
  - #27: `util/core`, `readonlyMessage` fn, `driver` override, drizzle db type.

  The v0.1.1 notes are in draft PR #22.

- Phase 5: ready branches `docs/ecosystem-kit` for xtandard (lib) 3dd2b5e, xyte 1a21d22 and
  xtandard-image f0c6522 were sent to t1r.
- Shared kit tarballs use unique names now (`0.1.1-dev.<sha>`), so no lockfile or cache dance.

## 2026-11-22: published; product PRs

- 0.1.0 published by the owner (manual first publish); trusted publishing configured.
- The tag-triggered `kit-release.yml` run for v0.1.0 failed: `npm publish "pack/<tgz>"` is read as
  a GitHub shorthand. Fixed in #28 (`./pack/`), with a test, and in each product's `release.yml`.
- v0.1.1 (#22) merged and tagged; published by `kit-release.yml` with provenance; `v0.1` moved.
- The product branches move to `^0.1.1`, PRs opened by workers (brief `MIGRATE-FINISH.md`); the lead
  reviews and merges.
- t1r merged the ecosystem PRs: xtandard #39, xyte #8, xtandard-image #178.
