# Changelog

All notable changes to `@xtandard/kit` are documented here. The project uses ZeroVer (`0.x`): a
MINOR bump is breaking, a PATCH bump is a fix or a backwards-compatible addition (ADR 0007). Each
entry names the products it affects.

## Unreleased

- Initial package: subpath layout, toolchain, inventory, plan and ADRs.
- Server side (wh, fl, au, li, en): `auth`, `authorization` (`defineActions`, roles engine), `hooks`
  (+ `isNamed`, `hooks/log` with `json`/`source`/`describe`), `tokens` (`createScopedTokens`:
  verifies every product's tokens, rejects empty secrets, secret rotation), `util` (durations with
  weeks, monotonic integer-ms id generators in the three persisted formats, validation core with
  finite JSON and no trailing-dot root paths, `validateUrl`), `testing` (`createTestClock`,
  `collectingSink`).
