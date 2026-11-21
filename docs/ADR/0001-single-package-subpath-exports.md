# ADR 0001 — Single package with subpath exports and optional peers

**Status:** Accepted

---

## Context

The kit spans many kinds of code:

- runtime code (storage drivers, auth, HTTP plumbing, adapters);
- browser code (the React admin shell and embed);
- build-time code (config factories, CSS scoping, docs-site tooling).

The products already ship as one package with subpath exports and optional peers (flags ADR 0001), and
the user decided on one new package, `@xtandard/kit`, separate from `@xtandard/lib`, whose core stays
zero-dependency.

The options were:

- several packages (`@xtandard/kit-storage`, `-ui`, `-site`…);
- one package with one entry point;
- one package with subpath exports.

## Decision

Ship **one package with explicit subpath exports**, mirroring flags and webhooks:

- Each subpath is a thin `src/entry-*.ts`, built by `vp pack` into dual ESM/CJS with `.d.mts`/`.d.cts`.
- The UI subpaths are ESM-only.
- Every driver, framework and tool dependency is an **optional peer**, owned by exactly one subpath
  and loaded with a dynamic `import()` behind `requirePeer`.
- `valibot` is the only runtime dependency.
- Build and site tooling live in the same package, under `/build` and `/site` and the `xtandard-kit`
  bin. They are only reachable through those subpaths, so a product's users never load them.

## Consequences

- Products add one dependency. Installing a product never pulls a database client, a framework or
  build tooling.
- Kit and product versions stay coherent within one package; there is no matrix between kit parts.
- The tarball is somewhat larger, because of the build/site tooling. That is accepted: it is a few
  hundred KB and is never imported at runtime.
- `entry-*.ts` files and the `package.json` exports must stay in sync. The api-surface check
  (ADR 0003) and publint catch drift.
