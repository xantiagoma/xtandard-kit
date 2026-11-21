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
- `@xtandard/kit/ui`, `/ui/embed`, `/ui/styles.css`: the shared admin shell (primitives, theme store
  keyed per product, `createApiClient`, `takeTokenFromUrl`, `bootSpa`, `ShellFrame` +
  `useShellConfig`, bits, format, `BrandMark`) and `createEmbed`. Carries every copy's UI fixes:
  portal waits for `/config` and a token means portal (wh lacked it), the token is stripped from the
  URL (wh/au/li), memory routing keeps the query string and a token swap refetches (wh/au/en), and
  the host-theme watcher guards a missing `MutationObserver` (fl). Affects all five products.
