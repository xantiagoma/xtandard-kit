/**
 * `@xtandard/kit/build` — build tooling shared by the xtandard products (also behind the
 * `xtandard-kit` bin):
 *
 * - `scopeCss` / `findUnscopedLeaks` / `scopeCssFile`: scope the React-embed stylesheet under the
 *   wrapper class (`xtandard-kit scope-embed-css`);
 * - `fixElysia2Types`: rewrite the `elysia-v2` alias in the Elysia 2 declarations;
 * - `apiSurface` / `diffApiSurface`: API-surface snapshots and the no-removals gate (ADR 0003);
 * - `defineXtandardConfig`, `defineUiConfig`, `defineEmbedConfig`, `definePlaywrightConfig`;
 * - `createExampleRunner` (the `scripts/example.ts` runner);
 * - `runEmbedCssSuite` / `runEmbedThemeE2e`: reusable test suites, test API injected.
 *
 * The shipped tsconfig bases live at `@xtandard/kit/tsconfig/base.json` and `react.json`.
 *
 * Optional peers: `postcss`, `postcss-prefix-selector`, `typescript`, `vite-plus`, `vite`,
 * `@vitejs/plugin-react`, `@tailwindcss/vite`, `@playwright/test` — each loaded only by the helper
 * that needs it.
 *
 * @module build
 */

export {
  findUnscopedLeaks,
  normalizeScope,
  scopeCss,
  scopeCssFile,
  type ScopeCssFileResult,
} from "./build/scope-css.ts";
export {
  fixElysia2Types,
  rewriteSpecifiers,
  type FixElysia2TypesOptions,
} from "./build/fix-elysia2-types.ts";
export {
  apiSurface,
  diffApiSurface,
  exportTarget,
  packageRoot,
  type ApiSurface,
  type ApiSurfaceDiff,
  type ExportTarget,
  type SubpathSurface,
} from "./build/api-surface.ts";
export {
  DEFAULT_THRESHOLDS,
  defineEmbedConfig,
  definePlaywrightConfig,
  defineUiConfig,
  defineXtandardConfig,
  type CoverageThresholds,
  type EmbedConfigOptions,
  type PlaywrightConfigOptions,
  type UiConfigOptions,
  type XtandardConfigOptions,
} from "./build/config.ts";
export {
  createExampleRunner,
  findFreePort,
  type ExampleConfig,
  type ExampleRunner,
  type ExampleRunnerOptions,
  type SpawnLike,
} from "./build/examples.ts";
export {
  EMBED_CSS_SAMPLE,
  luminance,
  runEmbedCssSuite,
  runEmbedThemeE2e,
  type EmbedCssSuiteOptions,
  type EmbedHostOptions,
  type EmbedThemeE2eOptions,
  type PlaywrightApi,
  type SuiteApi,
} from "./build/testing.ts";
