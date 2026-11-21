/**
 * `@xtandard/kit/hooks` — the hooks runner: `before` hooks run sequentially
 * and may deny with `HookDeniedError`, `after` hooks run concurrently with
 * isolated errors. Generic over a product's event unions. Also `isNamed`, for
 * mapping domain errors across bundles by name.
 *
 * @module
 */

export {
  createHookErrorReporter,
  defaultHookErrorReporter,
  hookDeniedStatus,
  HookDeniedError,
  isNamed,
  normalizeHooks,
  runAfter,
  runBefore,
  type HookErrorReporter,
  type HookEvent,
  type Hooks,
  type HooksInput,
} from "./hooks/contract.ts";
