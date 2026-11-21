/**
 * `@xtandard/kit/storage/testing` — the shared storage conformance suite. The test API is
 * injected (`{ describe, test, expect }` from vitest, `bun:test`, …), so products run the same
 * cases against their wrapped drivers and register extra suites with `runConformanceCases`.
 *
 * @module
 */

export {
  capabilitiesCase,
  compareAndSwapCases,
  contractCases,
  requireCompareAndSwap,
  requireWatchable,
  runConformanceCases,
  runStorageConformance,
  settle,
  watchCases,
  type ConformanceCapabilities,
  type ConformanceCase,
  type ConformanceContext,
  type ConformanceMatchers,
  type ConformanceOptions,
  type ConformanceTestApi,
  type MakeStorage,
  type SeedLegacy,
} from "./storage/testing/conformance.ts";
export {
  asRedisClient,
  fakeRedis,
  type FakeRedis,
  type FakeRedisOptions,
} from "./storage/testing/fake-redis.ts";
