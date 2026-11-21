# ADR 0003 — Products consume the kit as a dependency, re-export it, and prove API compatibility

**Status:** Accepted

---

## Context

Each product's public API must keep working: subpaths such as `@xtandard/webhooks/storage/redis`,
product-prefixed names, config shapes, the CLI, the HTTP API and stored data. Users must never install
or configure the kit themselves.

## Decision

- Each product lists `@xtandard/kit` in `dependencies` at `^0.MINOR.0`. Its `vp pack` keeps the kit
  **external**, so kit patches reach users without a product release (ADR 0007).
- Products keep every existing subpath and `entry-*.ts`. Each entry re-exports kit symbols, renaming
  them where the product name appears (`webhooksPanel`, `WebhooksStorage`). Thin wrapper modules inject
  product defaults.
- Product-named **types** are aliases of kit types, or interfaces that extend them, so values flow both
  ways without casts.
- Before and after each migration, `xtandard-kit api-surface <dist>` writes, for every subpath, the
  runtime export names (by importing `dist/`) and the exported type names (from the `.d.mts`). A
  migration PR must show **no removals**. Any unavoidable change goes in the product CHANGELOG with a
  Migration section.

## Consequences

- Product packages shrink to domain code plus wrappers. Their tests keep running against their public
  entries.
- Error messages from kit drivers name the peer to install, which is what the user needs. They may
  mention the kit subpath that raised the error.
