/**
 * `@xtandard/kit/adapters/elysia` — `createPass` for Elysia 1.x and 2.x: rebuild
 * the request Elysia already parsed (POST/PUT/PATCH/DELETE, stale
 * `content-length` dropped, strings passed through), a `raw` handler for
 * `parse: "none"` routes, and plugin options with `seed: prefix` for
 * multi-mount. No runtime `elysia` import.
 *
 * Optional peer: `elysia` (the product builds the typed chain).
 *
 * @module
 */

export {
  createPass,
  type CreatePassOptions,
  type CreatePassResult,
  type PassContext,
} from "./adapters/elysia.ts";
