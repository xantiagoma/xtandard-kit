# Utilities and test helpers

Small pieces every product uses: `@xtandard/kit/util` (durations, ids, validation, JSON types) and
`@xtandard/kit/testing`. `@xtandard/kit/util/core` is the dependency-free part (durations, ids,
canonical JSON, the JSON and `Actor` types). It never loads `valibot`, so hot paths that only mint
ids or parse durations stay light.

## Durations

```ts
import { durationToMs, parseDurationList, type Duration } from "@xtandard/kit/util";

durationToMs("5m"); // 300000; units ms s m h d w, or a plain number of ms
parseDurationList("0,30s,5m,1h"); // [0, "30s", "5m", "1h"] — validated eagerly (RETRY_SCHEDULE)
```

Negative, non-finite or malformed values throw.

## Ids

Products persist ids, so each one keeps its format (ADR 0005):

| `format`         | Shape                                                    | Sortable | Product      |
| ---------------- | -------------------------------------------------------- | -------- | ------------ |
| `"ulid"`         | `prefix_` + 26 Crockford base32 (10 time + 16 random)    | yes      | audit, links |
| `"ulid-lower22"` | `prefix_` + 22 lowercase Crockford (10 time + 12 random) | yes      | entitlements |
| `"base62"`       | `prefix_` + 22 base62 (128 random bits)                  | no       | webhooks     |

```ts
import { createIdGenerator } from "@xtandard/kit/util";

export const { newId, idPattern, idTime } = createIdGenerator({
  format: "ulid",
  prefixes: ["evt", "chk"], // infers the prefix union; other prefixes throw
});
newId("evt"); // "evt_01JD3Z…"
idTime("evt_01JD3Z…"); // unix ms, or null (malformed id, or base62)
```

- The sortable formats encode **integer** milliseconds, so a fractional clock is floored.
- They are **monotonic** within a generator. Ids minted in the same millisecond, or under a clock
  that went backwards, increment the random part.
- These fixes now reach entitlements' format too; its old generator drew fresh randomness for each
  id.
- Each generator has its own state, and a `now` option injects the clock.

## Validation

```ts
import {
  assertValid,
  issuesFrom,
  jsonValueSchema,
  parseInput,
  validateKeySegment,
  validateUrl,
  ValidationError,
} from "@xtandard/kit/util";
```

- `ValidationIssue { path, message }`, `ValidationResult { valid, errors }`, and `assertValid`.
- `ValidationError` carries the issues as `errors`, with `issues` as an alias.
- `issuesFrom(valibotIssues, basePath)` maps valibot issues to dotted paths:
  - a root issue gets `basePath` itself, with no trailing `.`;
  - a strict object's extra key reads `"unknown field"`.
- `parseInput(schema, input, { basePath, error })` returns the typed output or throws. `error`
  lets a product throw its own class.
- `jsonValueSchema` / `jsonObjectSchema` require **finite** numbers. `NaN` and `Infinity` would
  otherwise serialise to `null`.
- `validateKeySegment(value, path)` checks caller-supplied storage key segments: `[a-zA-Z0-9._-]+`,
  and not only dots.
- `validateUrl(value, path, policy)` always rejects `javascript:`, `data:`, `file:`, `blob:`,
  `vbscript:` and `about:`.

  ```ts
  // webhook endpoint: https only (http on localhost), no credentials
  validateUrl(url, "endpoint.url", {
    allowedSchemes: ["https:", "http:"],
    requireHttps: true,
    rejectCredentials: true,
  });
  // link destination: any safe scheme (app deep links), plus a host check
  validateUrl(url, "link.url", { policy: (u) => (blocked(u.host) ? "host is blocked" : null) });
  ```

## JSON and shared types

`canonicalStringify` (sorted keys, throws on non-finite numbers), `JsonValue`, `JsonObject` and
`Actor { id; type?; email?; name? }`.

## Test helpers — `@xtandard/kit/testing`

```ts
import { collectingSink, createTestClock } from "@xtandard/kit/testing";

const clock = createTestClock("2026-01-01T00:00:00Z");
clock.advance("1h"); // pass clock.now as a `now` option

const sink = collectingSink<AuditEvent>({ clone: true });
sink.failNext(2); // the next two push() calls reject — exercises retry paths
await sink.push(event);
sink.items; // everything received, in order
```
