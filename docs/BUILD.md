# Build tooling

`@xtandard/kit/build` and the `xtandard-kit` bin replace the scripts and configs every product
carried a copy of: `scripts/scope-embed-css.ts`, `scripts/fix-elysia2-types.ts`,
`scripts/vendor.d.ts`, the example runner, `vite.config.ts`, `vite.ui.config.ts`,
`vite.react.config.ts`, `playwright.config.ts`, `tsconfig.react.json` and the embed-CSS and
embed-theme tests.

Each helper loads its tool only when it runs, so the peers stay optional: `postcss` and
`postcss-prefix-selector` (CSS scoping), `typescript` (api-surface), `vite-plus`, `vite`,
`@vitejs/plugin-react` and `@tailwindcss/vite` (configs), `@playwright/test` (e2e). The products
already have all of them as devDependencies.

## The `xtandard-kit` command

```sh
xtandard-kit scope-embed-css --scope .xtandard-flags [--css dist/react.css]
xtandard-kit fix-elysia2-types [--dir dist/types-elysia2]
xtandard-kit api-surface <dist-or-pkg-dir> [--out file]
xtandard-kit api-surface --diff before.json after.json
```

The product scripts become:

```json
{
  "build:elysia2-types": "tsc -p tsconfig.elysia2.build.json && xtandard-kit fix-elysia2-types",
  "build:react": "vite build --config vite.react.config.ts && xtandard-kit scope-embed-css --scope .xtandard-flags && tsc -p tsconfig.react.json"
}
```

### `scope-embed-css`

The embed build emits `dist/react.css` as a full, unscoped Tailwind build. A host importing it
would get its whole page restyled. The command prefixes every rule with the wrapper class:

- `:root`, `html`, `:host` and `body` become the wrapper itself, so the tokens and the page surface
  (background, text colour, font) apply to the embed only;
- compound roots keep their qualifier: `:root[data-theme="dark"]` → `.xtandard-flags[data-theme="dark"]`,
  and also `:root.dark` and `:root:not(…)` (fl's transform; wh's only handled `[`-qualified roots);
- keyframe steps are left alone.

Then it fails if any rule could still restyle the host: preflight resets, the universal
custom-property rule, or token blocks left on `:root`/`html`/`body`. The scope is a single class
(`--scope xtandard-flags` gets its dot added). The same transform is available as
`scopeCss(css, scope)`, `findUnscopedLeaks(css, scope)` and `scopeCssFile(path, scope)`.

### `fix-elysia2-types`

`tsc -p tsconfig.elysia2.build.json` checks against the `elysia-v2` devDep alias, and may spell it
in the declarations (`import("elysia-v2/types")`). Consumers install Elysia 2 as plain `elysia`, so
the command rewrites `"elysia-v2"` and `"elysia-v2/…"` specifiers in every `.d.ts`, `.d.mts` and
`.d.cts` under the directory.

### `api-surface`

The API-surface gate (ADR 0003). For every `exports` subpath of a built package it records:

- `runtime`: the export names, by importing the ESM entry;
- `types`: every exported name in the `.d.mts`, read with the TypeScript compiler API (so
  `export *` chunks are followed).

Wildcard, CSS, JSON and `./package.json` exports are skipped. A subpath that can't be imported
(for example a missing peer) is recorded with an `error`.

```sh
bun run build && xtandard-kit api-surface . --out /tmp/before.json   # on main
# … migrate …
bun run build && xtandard-kit api-surface . --out /tmp/after.json
xtandard-kit api-surface --diff /tmp/before.json /tmp/after.json     # exits 1 on any removal
```

Additions are printed with `+`, removals with `-`. A subpath that starts failing to import also
counts as a removal.

It compares **names, not signatures**. A changed parameter type, a narrowed union or a removed
interface member keeps the same names, so it passes. Type-shape changes still rely on the
product's own type tests (`*.test-d.ts`) and typecheck.

## Config factories

```ts
// vite.config.ts
import { defineConfig } from "vite-plus";
import { defineXtandardConfig } from "@xtandard/kit/build";

export default defineConfig(
  defineXtandardConfig({
    entries: ["src/index.ts", "src/entry-storage-redis.ts", "src/cli.ts"],
    coverage: { thresholds: { statements: 92, branches: 85, functions: 90, lines: 92 } },
    typecheck: true, // test/**/*.test-d.ts (en)
  }),
);
```

`defineXtandardConfig` holds the shared skeleton:

- the `core` test project and the `elysia2` project (`elysia` aliased to `elysia-v2`; set
  `elysia2: false` to drop it);
- `retry: 2`;
- v8 coverage over `src/**/*.ts`, excluding `src/ui/**`, `src/entry-*.ts`, `src/index.ts` and
  `src/cli.ts`, with the family thresholds 90/82/90/90 unless you pass your own;
- the lint and fmt ignores (`CHANGELOG.md`, `site/**/*.mdx`, `MISSION.md`);
- the `staged` formatter with `--no-error-on-unmatched-pattern`;
- `pack` (ESM + CJS, `.d.mts`/`.d.cts`, sourcemaps, `bun:*` never bundled).

Extra excludes and ignores are appended (`coverage.exclude`, `lintIgnore`, `fmtIgnore`,
`neverBundle`).

```ts
// vite.ui.config.ts
import { defineUiConfig } from "@xtandard/kit/build";
export default defineUiConfig(); // root src/ui → dist/ui, base "./", emptied first

// vite.react.config.ts
import { defineEmbedConfig } from "@xtandard/kit/build";
export default defineEmbedConfig({ entry: "src/react.tsx" }); // en: entry-react-embed.ts, fileName "react-embed.js"

// playwright.config.ts
import { definePlaywrightConfig } from "@xtandard/kit/build";
export default definePlaywrightConfig({
  port: 3311,
  serverCmd: "bun run build:ui && bun run build:react && bun e2e/server.ts",
});
```

- The UI and embed configs load `@vitejs/plugin-react` and `@tailwindcss/vite` when vite reads the
  config (vite accepts a promise). The embed keeps React external and bundles everything else, the
  kit UI included.
- The SPA build empties `dist/ui` first; that directory only ever holds the SPA. The embed build
  never empties `dist/`. (fl's config comment said the opposite of its code.)
- The Playwright config passes `PORT` to the server through `webServer.env`, waits on
  `/healthcheck` (`healthPath`), retries once and uses the GitHub reporter on CI, and reuses a
  running local server. `workers`, `timeout`, `env` and `testDir` are options.

## tsconfig bases

```jsonc
// tsconfig.json
{ "extends": "@xtandard/kit/tsconfig/base.json", "include": ["src", "test", "scripts"] }
// tsconfig.react.json
{
  "extends": "@xtandard/kit/tsconfig/react.json",
  "compilerOptions": { "outDir": "dist/types-react", "rootDir": "src" },
  "include": ["src/react.tsx"],
}
```

`base.json` is the family's compiler setup (ESNext, `module: Preserve`, bundler resolution,
`.ts` imports, `verbatimModuleSyntax`, strict, `noUncheckedIndexedAccess`, `types: ["bun"]`).
`react.json` adds declaration-only emit for the embed's types. Both include `assets.d.ts`, the
module types for Vite asset imports (`*?raw`, `*.svg`, `*.png`, `*.css`), which replaces each
product's `src/ui/assets.d.ts`. `outDir`, `rootDir` and `include` are relative to the file that
declares them, so they stay in the product.

## The example runner

```ts
// scripts/example.ts
import { createExampleRunner, type ExampleConfig } from "@xtandard/kit/build";

export const EXAMPLES: Record<string, ExampleConfig> = {
  hono: {
    dir: "examples/hono",
    kind: "server",
    run: ["bun", "src/index.ts"],
    demo: ["bun", "src/demo.ts"],
    preferredPort: 3000,
    panelPath: "/webhooks",
  },
  // …
};

if (import.meta.main) process.exit(await createExampleRunner(EXAMPLES).main(process.argv.slice(2)));
```

`bun scripts/example.ts hono` runs the server on a free port near `preferredPort` and prints the
panel URL. `--demo` runs the non-interactive demo instead, `all --demo` runs every demo in turn,
and `install: "run" | "always"` installs an example's own dependencies on first use. `seed` runs
once before the interactive run (e.g. flags' Next.js example). `demo` is optional: an example
without one is skipped by `all --demo`.

## Reusable test suites

The test API is injected, so the suites run under vitest, `bun:test` and Playwright:

```ts
// test/embed-css.test.ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { runEmbedCssSuite } from "@xtandard/kit/build";

runEmbedCssSuite(
  { describe, it, expect },
  {
    scope: ".xtandard-flags",
    // Optional: also check the built stylesheet when it exists.
    readBuiltCss: () => readFile("dist/react.css", "utf8").catch(() => undefined),
  },
);
```

```ts
// e2e/embed-theme.spec.ts
import { expect, test } from "@playwright/test";
import { runEmbedThemeE2e } from "@xtandard/kit/build";

runEmbedThemeE2e(
  { test, expect },
  {
    scope: ".xtandard-flags",
    open: async (page, { htmlClass, theme }) => {
      /* serve the host page with <html class={htmlClass}> and the embed's theme={theme} */
    },
    openDialog: (page) => page.getByRole("button", { name: "New flag" }).click(),
  },
);
```

The theme cases are: `inherit` follows a class-based dark host while the OS is light (and its
dialogs do too), `inherit` switches live when the host toggles its class, `inherit` falls back to
`prefers-color-scheme`, `auto` keeps its own switcher and themes only its wrapper, and `dark` stays
fixed.
