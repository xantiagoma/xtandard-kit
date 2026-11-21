/**
 * `@xtandard/kit/util` — small shared utilities: durations, id generators (the
 * products' three persisted formats), the validation core, canonical JSON and
 * the JSON / `Actor` types.
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
  assertValid,
  FORBIDDEN_URL_SCHEMES,
  issuesFrom,
  jsonObjectSchema,
  jsonValueSchema,
  KEY_SEGMENT_REGEX,
  parseInput,
  resultOf,
  validateKeySegment,
  validateUrl,
  ValidationError,
  type ParseInputOptions,
  type UrlPolicyOptions,
  type ValidationIssue,
  type ValidationResult,
} from "./util/validation.ts";
export {
  canonicalStringify,
  type CanonicalInput,
  type JsonObject,
  type JsonValue,
} from "./internal/json.ts";
export type { Actor } from "./util/types.ts";
