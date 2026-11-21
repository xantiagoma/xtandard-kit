# Hooks

Hooks run around state mutations. `before` hooks may deny a write; `after` hooks see it once it has
committed. The runner is shared by every product, and the event unions are the product's.

## The runner — `@xtandard/kit/hooks`

```ts
import {
  createHookErrorReporter,
  HookDeniedError,
  normalizeHooks,
  runAfter,
  runBefore,
  type Hooks,
  type HooksInput,
} from "@xtandard/kit/hooks";

type WebhooksHooks = Hooks<BeforeEvent, AfterEvent>; // both unions have a `type` discriminant

const hooks = normalizeHooks(options.hooks); // single | array | undefined → array
await runBefore(hooks, { type: "endpoint.upsert", endpoint }); // sequential, the first throw aborts
await storage.setItem(key, endpoint);
await runAfter(hooks, { type: "endpoint.upserted", endpoint }, onHookError); // concurrent, isolated
```

| Phase    | Order        | Errors                                                                                           |
| -------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `before` | sequential   | The first throw aborts the remaining hooks and the write, and propagates to the caller.          |
| `after`  | concurrently | Each error goes to the `HookErrorReporter`; the caller never sees it, and other hooks still run. |

- `createHookErrorReporter("@xtandard/webhooks")` warns with
  `[@xtandard/webhooks] after-hook for "<type>" threw:`.
- `defaultHookErrorReporter` uses the `[@xtandard/kit]` prefix.

## Denying

```ts
throw new HookDeniedError("Publishing is frozen until Jan 2.", { status: 423 }); // default 403
```

The API layer answers with `status` and `code: "HOOK_DENIED"`. A plain `Error` thrown from `before`
is a bug, not a policy decision, and maps to 500.

## Mapping errors across bundles — `isNamed`

A hook loaded from another subpath bundle throws **its own copy** of `HookDeniedError`, so
`instanceof` fails. Every domain error is therefore mapped by `name`:

```ts
import { hookDeniedStatus, isNamed } from "@xtandard/kit/hooks";

const denied = hookDeniedStatus(err); // status of a HookDeniedError (any bundle), else null
if (denied !== null) return error(denied, err.message, { code: "HOOK_DENIED" });
if (isNamed(err, "NotFoundError")) return error(404, err.message, { code: "NOT_FOUND" });
```

`isNamed(error, name)` matches any error object whose `name` is `name`, including errors from other
realms. The server's `mapError` is built on it (`docs/SERVER.md`).

## The log hook — `@xtandard/kit/hooks/log`

```ts
import { createLogHook } from "@xtandard/kit/hooks/log";

createLogHook({
  source: "@xtandard/flags", // prefix / `source` field
  describe: (e) => `${e.projectKey}/${e.environmentKey}`, // extra text-format field
  includeBefore: false,
  json: false, // true → one JSON object per line: { source, phase, ...event }
});
// [@xtandard/flags] after flag.upserted web/prod {"type":"flag.upserted",…}
```

It never throws from `before`, so it never denies a write. `format(phase, event)` replaces the whole
line, and `log(line)` replaces `console.log`.
