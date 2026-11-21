# UI and tooling area: build summary (for product migrations)

PRs: #3 (ui kit + embed + styles), #6 (build tooling), #14 (site tooling, docs site, reusable
workflows). All merged. Docs: `docs/{UI,BUILD,SITE,WORKFLOWS,RELEASES}.md`. Site:
https://me.xantiagoma.com/xtandard-kit/

## Subpaths

| Subpath                       | Contents                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@xtandard/kit/ui`            | primitives, ui-bits, Toast, ThemeToggle, `cn`, nav-guard, portal-container; `createThemeStore(key)`, `detectHostTheme`, `subscribeHostTheme`, `ThemeProvider`, `useTheme`; `createApiClient({ errorClass })`, `toQuery`; `takeTokenFromUrl`; `bootSpa`; `ShellFrame` + `useShellConfig` + `useShellNav`; bits; format; `BrandMark` |
| `@xtandard/kit/ui/embed`      | `createEmbed({ App, scopeClass, api, themeKey })` → `{ Dashboard, TokenEmbed, themeStore }`, `useEmbedRouting`                                                                                                                                                                                                                     |
| `@xtandard/kit/ui/styles.css` | Tailwind import, tokens and layers, `--code-*`/`.tok-*`, `--chart-track`; `@source` lines for exactly the compiled UI chunks (`scripts/build-ui-assets.ts`)                                                                                                                                                                        |
| `@xtandard/kit/build` + bin   | `scopeCss`/`findUnscopedLeaks`/`scopeCssFile`, `fixElysia2Types`, `apiSurface`/`diffApiSurface`, `defineXtandardConfig`/`defineUiConfig`/`defineEmbedConfig`/`definePlaywrightConfig`, `createExampleRunner`, `runEmbedCssSuite`, `runEmbedThemeE2e`. Bin commands: `scope-embed-css`, `fix-elysia2-types`, `api-surface [--diff]` |
| `@xtandard/kit/tsconfig/*`    | `base.json`, `react.json`, `assets.d.ts`                                                                                                                                                                                                                                                                                           |
| `@xtandard/kit/site`          | `defineSiteManifest` (+ `apiEntries`), `syncSite`/`runSync`, `createTypedocPlugin`, `apiOverviews`, `defineXtandardSite`, `importFromSite`                                                                                                                                                                                         |
| `.github/workflows/`          | reusable `pages.yml`, `docker.yml`, `release-prepare.yml` (plus the existing `ci.yml`); the kit's callers `kit-ci.yml` (e2e on), `kit-pages.yml`, `kit-release.yml`                                                                                                                                                                |

## Inventory §3 UI/tooling fixes → where tested

| Fix (copies that lacked it)                                                                                             | Test                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| portal SPA waits for `/config` before the default route (wh)                                                            | `test/ui-react.test.tsx` "is not ready (no admin work) until /config answers"                                                           |
| a token means portal (en's approach)                                                                                    | `test/ui-react.test.tsx` "treats a token as portal from the first render"                                                               |
| SPA strips `?token=`/`#token=` from the address bar (wh, au, li)                                                        | `test/ui-token.test.ts`; `e2e/kit.spec.ts` "bootSpa themes <html> … token leaves the URL"                                               |
| embed memory router keeps the query string (wh, fl, au, en)                                                             | `test/ui-react.test.tsx` "memory routing keeps the query string"; `e2e/kit.spec.ts` "tabs navigate in memory and keep the query string" |
| invalidate queries on token change (wh, au, en)                                                                         | `test/ui-react.test.tsx` "TokenEmbed … invalidates queries on token change"                                                             |
| theme host watcher guards a missing `MutationObserver` (fl)                                                             | `test/ui-theme.test.ts` "works without MutationObserver"                                                                                |
| embed CSS + portals scoped; one theme per embed                                                                         | `test/build-scope-css.test.ts` (`runEmbedCssSuite`); `e2e/kit.spec.ts` scoping cases plus the five `runEmbedThemeE2e` cases             |
| compound root selectors (`:root.dark`, `:root:not(…)`) re-homed (wh, au, li, en)                                        | `test/build-scope-css.test.ts` "re-homes any compound root selector"                                                                    |
| embed-css unit test (en lacked one)                                                                                     | shipped as `runEmbedCssSuite`, for every product                                                                                        |
| `vite.ui.config` comment contradicted `emptyOutDir` (fl)                                                                | `test/build-config.test.ts` (`defineUiConfig` empties `dist/ui`; the embed config never empties `dist/`)                                |
| https `og:url`/`og:image`/sitemap                                                                                       | `test/site-manifest-sync.test.ts` "resolves URLs … (https, env overrides)"                                                              |
| re-export detection counts only `export … from` (fl e98d7db)                                                            | `test/site-api.test.ts` "writes /api/ and each module page"                                                                             |
| `apiOwners` validation (missing in wh, li, en); `og:image:alt`; favicon sizes; `theme-color`; `errorOnLocalLinks:false` | `test/site-api.test.ts` "orders entry points … validates them", "assembles the Astro config"                                            |
| one pending-guide design (au's and en's were incompatible)                                                              | `test/site-manifest-sync.test.ts` "leaves pending guides out…", "links to a pending guide's page once it lands"                         |
| `docker.yml` missing in en; smoke paths drift (li); bun drift                                                           | reusable `docker.yml` inputs (actionlint; exercised once products adopt it)                                                             |
| CI `typecheck:examples` skipped (en)                                                                                    | `ci.yml` `typecheck-examples` input                                                                                                     |

New fixes found while building (each with a test): JSON `content-type` merged case-insensitively (`ui-api-client`); `takeTokenFromUrl` leaves a hash route alone (`ui-token`); TokenEmbed invalidates only on change and clears the token on unmount (`ui-react`); the leak guard catches `:root`/`html`/`body` token blocks and look-alike classes (`build-scope-css`); api-surface takes a fresh ESM instance per snapshot (`build-bin`); the overview writer no longer hits EISDIR on a module with no entry, and a bare `@module` gets its subpath name (`site-api`); site peers resolve from the site's own install (`site-resolve`); docker smoke-tests before it pushes; release-prepare checks the tag against the version.

## What a product migration must pass (values it ships today; ADR 0010)

| Seam             | Where                                                                                                                                                           | Example (webhooks)                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| scope class      | `createEmbed({ scopeClass })`, `xtandard-kit scope-embed-css --scope`                                                                                           | `"xtandard-webhooks"`                                                        |
| config global    | `bootSpa({ configGlobal })`, `readConfigGlobal`                                                                                                                 | `"__WEBHOOKS_CONFIG__"`                                                      |
| theme key        | `bootSpa({ themeKey })`, `createEmbed({ themeKey })`, `createThemeStore`                                                                                        | `"xtandard-webhooks:theme"`                                                  |
| error class      | `createApiClient({ errorClass })`                                                                                                                               | `class WebhooksApiError extends ApiError {}`                                 |
| brand tokens     | the product stylesheet, after the kit import                                                                                                                    | `:root { --accent … }` and `:root[data-theme="dark"] { … }`                  |
| Tailwind import  | **replace** `@import "tailwindcss"` with `@import "@xtandard/kit/ui/styles.css"`; never import Tailwind twice                                                   | fallback if `@source` misses: `@source "../node_modules/@xtandard/kit/dist"` |
| token routing    | `createEmbed({ tokenRouting })`                                                                                                                                 | wh/au/en `"hash"` (today's default); li `"memory"`                           |
| public names     | re-export `embed.Dashboard`/`TokenEmbed` under the product names; `export const { getThemePref, setThemePref } = embed.themeStore`                              | `WebhooksDashboard`, `WebhooksPortal`                                        |
| mark             | `<BrandMark light={symbolLight} dark={symbol} />` (`?raw` SVG)                                                                                                  |                                                                              |
| API-surface gate | `xtandard-kit api-surface . --out before.json` / `after.json`, then `--diff`: no removals. It compares names only; type shapes rely on the product's type tests |                                                                              |

## Adopting the reusable workflows and `@xtandard/kit/site`

- **Workflows** (`docs/WORKFLOWS.md`): reference `xantiagoma/xtandard-kit/.github/workflows/<wf>.yml@v0.MINOR`.
  - `ci.yml` takes `db-name`, `typecheck-examples`, `e2e` and the service images.
  - `pages.yml` needs `pages: write` and `id-token: write`; the caller keeps its `paths` filter.
  - The `docker.yml` caller adds `workflow_dispatch` with a `refresh-kit` input; li passes its `smoke-paths`.
  - Each product keeps a small `release.yml`: it calls `release-prepare.yml`, then runs `npm publish pack/<tarball> --provenance` and `gh release create` itself. Its trusted publisher stays registered on that `release.yml`.
- **Site** (`docs/SITE.md`):
  - add `@xtandard/kit` (and `@astrojs/markdown-remark`) to `site/package.json`;
  - `site/manifest.ts` → `export const manifest = defineSiteManifest({ repoRoot, repoSlug, packageName, rootModule, base, sidebar })`;
  - `scripts/sync.ts` → `process.exit(runSync(manifest))`;
  - `astro.config.ts` → `export default await defineXtandardSite({ manifest, description, tagline, apiOwners, devPort })`;
  - delete `site/scripts/{sync,typedoc-plugin,api-overviews}.ts`;
  - a guide that hasn't landed yet becomes `pending: true`;
  - en's `pending` map entries become `pending: true` pages.
