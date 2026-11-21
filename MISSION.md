# Mission: `@xtandard/kit` — the shared building blocks of the xtandard products

You are the **lead** for extracting the infrastructure that the xtandard control-plane products copy
from each other into one shared package, and migrating the products onto it. You own it end to end:
inventory, design, implementation, tests, docs, docs site, CI/CD, release prep and the migration PRs
in the product repos. **Do not stop until the Definition of Done below is met.**

Your coordinator is the hc terminal **`t1r`** (report with `hc send t1r "…"`; its messages arrive
tagged `<hc from="t1r …">`). Keep this file unedited; your plan goes in `PLAN.md`, progress in
`WORKLOG.md`.

**Read first, fully:** `/Users/santi/Projects/xtandard-missions/ecosystem-lead-rules.md` (how to work:
team, rules, reporting; `<name>` = `kit`, package `@xtandard/kit`, repo `xantiagoma/xtandard-kit`,
docs at `https://me.xantiagoma.com/xtandard-kit/`). Where this mission differs from those rules
(scope, Definition of Done, touching other repos), this mission wins.

## Why

The products `@xtandard/flags`, `@xtandard/webhooks`, `@xtandard/audit`, `@xtandard/links` and
`@xtandard/entitlements` (repos `/Users/santi/Projects/xtandard-{flags,webhooks,audit,links,entitlements}`,
all on GitHub under `xantiagoma/`) were built by copying the same infrastructure from
xtandard-webhooks. The same storage bugs (MySQL collation + `LIKE … ESCAPE`, file-driver case
collisions, unstorage key normalisation, Redis SCAN MATCH escaping, SQL getKeys prefix filtering) had
to be fixed five times, once per repo. Fix that.

Candidates (verify, don't assume): KV storage contract + ~10 drivers + the conformance suite, key
encoding, auth (none/basic/delegated), authorization (none/roles/delegated), framework adapters
(elysia/elysia2/hono/express/bun), panel/SPA serving + scoped tokens, CLI scaffolding, the React
admin shell, docs-site tooling (typedoc plugin, sync.ts, api-overviews), CI/release workflows.

## Constraints (decided by the user)

- A **separate package**, not `@xtandard/lib` (lib's core stays zero-dep). Name: `@xtandard/kit`
  (repo `xantiagoma/xtandard-kit`, public, MIT, ZeroVer 0.x). If you have a strong reason for another
  name (the user floated shared/core/base/kit), say so to t1r before creating the repo.
- **Each product stays installable on its own:** the kit is a regular `dependency` of the products,
  never something users have to install or wire up themselves. The products' public API (exports,
  subpaths such as `@xtandard/flags/storage/redis`, config shapes, CLI, HTTP API, stored data
  format) must keep working; re-export from the kit where needed. Anything that cannot stay
  compatible goes in the product's CHANGELOG with a Migration section.
- Driver/framework deps stay **optional peers** of the kit (subpath per driver/adapter, like
  `@xtandard/lib`), so a product doesn't drag every database client in.
- Reusable GitHub workflows (`workflow_call`) for CI/release/pages live in the kit repo (or document
  why not); the products' workflows call them.
- Follow the xtandard repo shape for the kit repo itself (flags/webhooks are the references): Bun,
  same toolchain, `bun run check`, tests, README with "The xtandard ecosystem" section, `docs/`,
  `CLAUDE.md`, ADRs, CHANGELOG, Starlight docs site + API reference on GitHub Pages, release workflow
  with npm trusted publishing.

## Phases

1. **Inventory** → `docs/research/inventory.md`: diff the five repos area by area. For each area:
   identical / identical modulo names / diverged (how, and which version is best), LOC, and the bug
   fixes each copy has or lacks. Send t1r a short summary + the path.
2. **Design** → `PLAN.md` + ADRs: what goes in the kit and what stays product-specific; subpath
   layout; how products re-export; how the conformance suite is shared (e.g. a `…/testing` subpath);
   versioning policy between kit and products; the migration order (webhooks first, it's the origin).
   Send t1r the path; continue unless t1r objects within a reasonable time.
3. **Build the kit**: implementation (best version of each piece, with every bug fix from every
   copy), tests (unit, storage conformance across all drivers incl. Docker-backed ones, adapter
   tests, type tests), CI green, docs site live, release workflow + `npm pack --dry-run` clean. Then
   send t1r **"READY TO PUBLISH"** (the first npm publish of a new package needs the user's 2FA; t1r
   handles it). Don't publish yourself.
4. **Migrate the products**, one PR per repo (you may create branches/PRs in the five product repos
   and merge them once CI is green and you have reviewed the diff): replace the copied code with the
   kit, keep public API compatible, remove dead code, all tests green including each repo's own
   conformance/e2e. Migration PRs can be developed against a local/`file:` kit, but they merge only
   after the kit is on npm (t1r tells you). Don't release the products; tell t1r which ones need a
   release and why (t1r releases them).
5. **Ecosystem**: add the kit to the "The xtandard ecosystem" tables/site cards (as a building block)
   in all repos — give t1r ready branches or do it in the migration PRs.

## Machine load (important: the machine has been overloaded before)

- At most 3 workers at a time. Run heavy jobs (full test suites, builds, docs builds, Docker-backed
  conformance) through `/Users/santi/Projects/xtandard-missions/heavy.sh <command…>` (machine-wide
  slots).
- Never run `find /` or other whole-disk scans. Stop Docker containers you start.
- After the local gate passed, push with `--no-verify` (hooks would re-run everything).

## Definition of Done

1. Inventory, PLAN.md and ADRs committed in xtandard-kit.
2. `@xtandard/kit` implemented and tested; CI green; docs site live at
   `https://me.xantiagoma.com/xtandard-kit/`; release workflow with trusted publishing ready;
   READY TO PUBLISH sent and the package published by t1r.
3. All five products migrated (merged PRs, CI green, public API compatible or documented), with the
   list of product releases needed sent to t1r.
4. The kit in every repo's ecosystem section.
5. Final report to t1r: what moved where, LOC removed per repo, how to verify, known gaps, and a short
   "how to add a fix once" note (also in the kit's CLAUDE.md).
