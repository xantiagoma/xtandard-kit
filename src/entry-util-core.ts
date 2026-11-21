/**
 * `@xtandard/kit/util/core` — the dependency-free part of `@xtandard/kit/util`: durations, id
 * generators, canonical JSON and the JSON / `Actor` types. It never loads `valibot`, so hot paths
 * that only mint ids or parse durations stay light. `@xtandard/kit/util` re-exports all of it plus
 * the validation core.
 *
 * @module
 */

export { durationToMs, parseDurationList, type Duration } from "./util/duration.ts";
export {
  createIdGenerator,
  type IdFormat,
  type IdGenerator,
  type IdGeneratorOptions,
} from "./util/id.ts";
export {
  canonicalStringify,
  type CanonicalInput,
  type JsonObject,
  type JsonValue,
} from "./internal/json.ts";
export type { Actor } from "./util/types.ts";
