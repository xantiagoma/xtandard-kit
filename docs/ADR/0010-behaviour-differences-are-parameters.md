# ADR 0010 — Divergent public behaviour becomes a parameter, never a silent unification

**Status:** Accepted

---

## Context

The copies differ in behaviour that users can observe through the HTTP API, the CLI or stored data:

- the readonly status code: 403 in wh/fl/li, 423 in au/en;
- validation of invalid integer query parameters;
- the token prefixes `whpt_`, `audpt_`, `lvt_` and `entpt_`;
- the id formats;
- the default realm;
- the shape of the bootstrap config.

There is also a second kind of difference: fixes that only some copies have. For example, unknown
`AUTH_MODE` or `STORAGE_DRIVER` values are rejected only in some copies, and title escaping is missing
in others.

## Decision

- **Behaviour that is part of a product's contract becomes a kit parameter.** Each product passes the
  value it ships today (`readonlyStatus`, `tokenPrefix`, `idFormat`, `realm`, `configGlobal`…).
  Changing it is a separate, product-level decision that needs a CHANGELOG Migration entry.
- **Fixes are not parameters.** The kit always behaves correctly:
  - it fails closed on unknown `AUTH_MODE` / `STORAGE_DRIVER`;
  - it escapes the HTML;
  - it keeps multiple `Set-Cookie` headers;
  - malformed `%` escapes don't cause a 500.

  Each product's migration PR lists these under "Fixed" in its CHANGELOG.

- **Urgent security fixes are not held for the migration.** For example, the unknown `AUTH_MODE`
  fail-open was hot-fixed in the four affected products on 2026-11-21.

## Consequences

- Migrations change no documented behaviour by accident. Every observable change is either a listed
  fix or an explicit product decision.
