# UI + tooling inventory

Repos are abbreviated **wh** (webhooks), **fl** (flags), **au** (audit), **li** (links), **en** (entitlements).
"≡names" means identical once the product name is replaced. Diff counts are normalised lines vs wh (matrix.tsv).
Everything below was checked by reading code or running small `diff`s, not taken from commit messages.

---

## A. React admin shell (`src/ui/**`)

### A1. Files that are already identical (copy them into the kit as they are)

| File | wh | fl | au | li | en | Status |
|---|---|---|---|---|---|---|
| `components/ui-bits.tsx` (Button, Badge, Avatar, Kbd) | 126 | 126 | 126 | 126 | 126 | byte-identical |
| `components/Toast.tsx` (ToastProvider, useToast, Toast, ToastKind) | 130 | 130 | 130 | 130 | 130 | byte-identical |
| `components/ThemeToggle.tsx` | 51 | 51 | 51 | 51 | 51 | byte-identical; imports `../theme.ts` (getThemePref/setThemePref) |
| `components/primitives.tsx` (ToggleSwitch, Segmented, Dropdown, CreatableCombobox, TextInput, TextArea) | 354 | 354 | 354 | 354 | 354 | identical. In fl the `portal-container` import is moved up two lines, nothing else. The file has a NUL sentinel (`"\0create"`, line 233), so `grep`/`file` treat it as binary: use `grep -a`. |
| `lib/utils.ts` (`cn`) | 8 | 8 | 8 | 8 | 8 | byte-identical |
| `lib/nav-guard.ts` (setNavBlocker/clearNavBlocker/canLeave) | 32 | 32 | 32 | 32 | 32 | byte-identical |
| `lib/portal-container.ts` (setPortalContainerRef/portalContainerRef) | 34 | 34 | 34 | 34 | 34 | ≡names (only the `.xtandard-<p>` mention in a comment differs) |

Deps of this set: `@base-ui-components/react`, `lucide-react`, `clsx`, `tailwind-merge`, `react`. These are devDeps in every repo, because they get bundled into dist/ui and dist/react.js.

### A2. `theme.ts` (+ fl `lib/theme-context.tsx`)

| | wh | fl | au | li | en |
|---|---|---|---|---|---|
| LOC | 126 | 140 (+62 theme-context) | 126 | 126 | 126 |
| status | base | **rewritten** | ≡names | ≡names | ≡names |

- **wh/au/li/en** export `ThemePref`, `ResolvedTheme`, `getThemePref`, `resolveTheme`, `setThemePref`, `subscribeThemePref(listener(pref))`, `subscribeSystemTheme`, `initTheme`, `detectHostTheme()` and `watchHostTheme`. Host detection looks for the `dark`/`light` class or `data-theme` on `<html>`, then `<body>`, then falls back to the OS setting.
- **fl** (`xtandard-flags:src/ui/theme.ts`) is better in four ways:
  - `subscribeThemePref(cb)` also follows OS changes while the preference is `system`, and its shape works with `useSyncExternalStore`.
  - `detectHostTheme(root?, body?)` takes a `ThemeSignalSource`, so it can be tested without a DOM.
  - It also reads `data-mode`, `data-color-scheme` and an inline `style.colorScheme` (next-themes sets that last one).
  - `watchHostTheme` is renamed `subscribeHostTheme`.
  - `lib/theme-context.tsx` adds `ThemeMode`, `useResolvedTheme` (with `useSyncExternalStore`), `ThemeProvider` (render-prop) and `useTheme()` → `{resolved, showToggle}`, so the toggle no longer has to be passed down as a prop.
  - It has its own unit test, `test/theme.test.ts` (80 lines).
- **fl regression:** `subscribeHostTheme` dropped the `typeof MutationObserver === "undefined"` guard that wh has (`xtandard-webhooks:src/ui/theme.ts:110`).
- **Best:** fl's API and theme-context, plus wh's SSR/MutationObserver guard.
- **Kit seam:** the localStorage key `xtandard-<p>:theme`.

### A3. `api.ts`: the fetch client core

What every copy shares is the same about 40 lines:
- module-level `apiBase`, `apiCredentials` and `apiFetch`;
- `FetchLike`, `ApiClientOptions`, `setApiBase(base, {credentials, fetch})`;
- `req<T>()`: JSON headers, error body → `<P>ApiError`, empty body → `undefined`;
- a `query()`/`toSearch()` helper.

The rest of each file is product endpoints (wh 316, fl 340, au 221, li 293, en 265 LOC).

| Feature | wh | fl | au | li | en |
|---|---|---|---|---|---|
| `setApiToken` (Bearer) | ✓ | ✗ (no portal) | ✓ | ✓ | ✓ |
| `apiUrl()` + split `send()` (Response, for blobs/CSV/JWKS) / `req()` | ✗ | ✗ | ✓ | ✓ | ✗ |
| `{...body, status}` forces the status into the error body | ✗ | ✗ | ✓ | ✓ | ✗ (body `{error}` only) |
| `getApiToken()` | ✗ | ✗ | ✗ | ✗ | ✓ |
| `setPreviewCustomer()` (adds `?customer=` to portal routes) | – | – | – | – | ✓ (product) |
| `query()` skips `null` | ✗ | – | ✗ | (toQuery supports arrays/booleans) | ✓ |

- **Best:** au/li's `send`/`req`/`apiUrl` split, en's `getApiToken`, and li's `toQuery` (array and boolean values).
- **Kit:** `createApiClient({ ErrorClass })` returning `{setApiBase, setApiToken, getApiToken, apiUrl, send, req, query}`, plus a generic `ApiError` body type. The error class name (`WebhooksApiError`…) stays product-side, either as a subclass or as an injected constructor.

### A4. `main.tsx` (SPA bootstrap)

LOC: wh 48, fl 41, au 48, li 40, en 52. The shape is the same everywhere: `initTheme()` → read the token → `QueryClient{retry:1, refetchOnWindowFocus:false}` → `basePath` from `window.__<P>_CONFIG__` → `<ToastProvider><App locationHook={useBrowserLocation} base/>`.

Where they differ:
- **wh** alone passes `showBrandMark`. The others render the mark themselves.
- **fl** has no token handling.
- **li** declares the `window.__LINKS_CONFIG__` global type in `App.tsx`, so `main.tsx` needs no cast.
- **en** uses `takeTokenFromUrl()` (`xtandard-entitlements:src/ui/lib/token.ts`). It reads `#token=` first, then `?token=`, and **removes the token from the address bar** with `history.replaceState`. wh, au and li read `?token=` and leave it in the URL, where it can be bookmarked, shared or show up in Referer headers. This is a generic security improvement that only en has. It is tested in `xtandard-entitlements:test/ui-lib.test.ts:253`.

**Kit:** `bootSpa({ App, configGlobal: "__<P>_CONFIG__", tokenFromUrl: boolean })`, using en's `takeTokenFromUrl`.

### A5. `index.html`

LOC: wh 17, fl 17, au 15, li 20, en 20. Title, description and favicon links are templated per product.
- fl, li and en use `favicon.ico sizes="any"`; wh uses `sizes="32x32"`.
- **au** links only `./brand/favicon.svg` (it has no `public/` dir: assets live in `src/ui/brand/`, imported as URLs). It has **no `.ico` and no apple-touch-icon**. That is drift.
- **Kit:** generate the HTML from `{title, description}`.

### A6. `styles.css`

LOC: wh 188, fl 218, au 189, li 191, en 207. Every copy has the same skeleton:
- `@import "tailwindcss"`;
- `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))`;
- the `@theme inline` mapping;
- `:root` / `:root[data-theme="dark"]` tokens;
- the base layer.

Differences:
- **wh/fl/au**: blue accent `oklch(0.55 0.2 256)`. au only adds Menlo/Consolas to `--font-mono`.
- **fl**: adds `--code-key/string/number/literal` tokens and `.tok-*` classes for CodeMirror's `classHighlighter`.
- **li/en**: brand-lime accent, retuned success/warning/info/chart colours. en also has `--chart-track`, `--mark-*` brand-mark colours and hue 247 neutrals instead of 285.

**Kit:** ship the base stylesheet. Each product provides a small `:root{--accent…}` brand-token overlay, plus optional `--code-*` tokens. The family appears to be converging on lime (li, en, and the docs-site brand.css everywhere).

### A7. `App.tsx`: shell vs product

LOC: wh 355, fl 590, au 370, li 339, en 247. The shell skeleton is the same in all five:
- `App({locationHook, base, logoUrl, initial…, showThemeToggle})` → `<Router hook base><AppShell/>`;
- `getBootstrap()` from `window.__<P>_CONFIG__`;
- `configQuery(["config"], getConfig, staleTime 60s)`;
- branding: prop `logoUrl` > `config.logoUrl` > title wordmark, with the xtandard mark only on the default title;
- read-only and portal badges, `ThemeToggle` when allowed;
- `NAV_TABS` with `adminOnly`, a `go()` that checks `canLeave()` and keeps the query string;
- a header with a tenant/app switcher, then `<Switch>` routes.

Product-specific:
- the scope switcher: app (wh), project+env (fl), tenant (au/li), none (en);
- the tabs and the views;
- the meaning of portal, viewer or forcePortal.

li has already pulled part of this into `xtandard-links:src/ui/lib/shell.tsx` (52 lines: `Shell`, `ShellContext`, `useShell`, `canPerform`).

Brand mark:
- **wh** inlines `<img src="symbol(-light).svg">`, served from `public/`, and only shows it when `showBrandMark`.
- **au** imports the SVGs as URLs from `src/ui/brand/`.
- **fl, li and en** have a `BrandMark` component: fl and li in `components/BrandMark.tsx`, en in `ent-bits.tsx`. It inlines the SVG as a data URL via `?raw`, so it works inside the embed with no asset to serve. fl chooses the variant with `useTheme()`; li and en render both variants with `dark:hidden`.

**Portal race fix** (au 6761a34, *"portal SPA waits for /config before the default route"*):

| Repo | Fix | Where |
|---|---|---|
| au | has it | `xtandard-audit:src/ui/App.tsx:170,334,358` (queries `enabled: configQuery.isSuccess`, default route rendered only once config loaded) |
| li | has it, ported without a fix commit | `xtandard-links:src/ui/App.tsx:135,220,265,291` |
| en | has it, different approach | `xtandard-entitlements:src/ui/App.tsx:96,111`: `portal = forcePortal \|\| config.mode==="portal" \|\| getApiToken()!==null`, and it renders nothing while loading |
| wh | **lacks it** | `xtandard-webhooks:src/ui/App.tsx:114-128`: `portal` comes from `configQuery.data ?? bootstrap`. The bootstrap can't know about a `?token=`, so before `/config` returns, `listApplications` fires (`enabled: !portal`) and `OverviewView` mounts. Both are admin requests that a portal token is denied. |
| fl | n/a | no portal |

**Kit:** a `<ShellFrame>` covering header, brand, badges, toggle, tabs and nav-guarded `go()`, plus a `useShellConfig()` hook. The hook should apply au's "wait for config" rule, with en's "a token means portal" shortcut. Products pass in the switcher slot, the tabs and the routes.

### A8. `lib/*` and component helpers (partly shared)

- **`lib/format.ts`** (wh 141, au 311, li 280, en 388; none in fl):
  - `formatDateTime` is identical in wh and au. li and en dropped the seconds.
  - `relativeTime` is identical in wh and au; li and en differ.
  - `truncate` is identical in wh, au and li.
  - `initials` exists only in li and en, and the two differ.
  - Everything else is product-specific.
  - **Kit:** `formatDateTime({seconds})`, `relativeTime`, `truncate`, `initials` and `formatCount`/`formatNumber`.
- **`*-bits.tsx`** (wh `webhook-bits` 226, au `audit-bits` 394, li `bits` 467, en `bits` 226 + `ent-bits` 428). The common subset is `Spinner`, `LoadingRow`, `Mono`, `PageHeader`, `SectionCard`, `ModalDialog`, `ConfirmDialog` and `EmptyCard`. `Page`, `Drawer` and `CopyButton` appear in au and li; `StatCard` in au and en. These are kit candidates; the status badges stay in the products.
- **`JsonCodeEditor.tsx`**: wh 133 = au 133 (identical); fl 116 uses `classHighlighter` with `.tok-*` CSS tokens; li and en don't have it. The kit can host it as an optional subpath, since it needs the `@codemirror/*` deps.
- **`TagInput.tsx`** (fl 69, li 116): candidate.
- **`assets.d.ts`** (fl, au, li): `*.svg?raw` / `*.svg` module types. Kit.

### A9. Public API of the UI area (the migration must keep these working)

- **package.json `exports`:**
  - `./ui/*` → `./dist/ui/*` (static SPA) in all 5;
  - `./react/styles.css` → `./dist/react.css` in all 5;
  - `./react`: wh, fl, au and li point at `dist/react.js` with types in `dist/types-react/react.d.ts`, ESM only. In **en**, `./react` is a different package: customer-facing hooks/components (`src/entry-react.ts`, built by `vp pack`, ESM+CJS). The admin embed lives at **`./react/embed`** (`dist/react-embed.js`), with an extra **`./react/components.css`** (copied in `build:react`).
- **Embed exports:**

| | wh | fl | au | li | en (`/react/embed`) |
|---|---|---|---|---|---|
| Dashboard | `WebhooksDashboard` (default) | `FlagsDashboard` (default) | `AuditDashboard` (default) | `LinksDashboard` (default) | `EntitlementsDashboard` (default) |
| Token component | `WebhooksPortal` | – | `AuditPortal` | `LinkAnalytics` (viewer token) | `CustomerPortal` |
| Props type(s) | `…DashboardProps`, `…PortalProps` | `FlagsDashboardProps` | ✓ | `…Props`, `LinkAnalyticsProps` | ✓ |
| Theme type | `EmbedTheme` | `ThemeMode` | `EmbedTheme` | `EmbedTheme` | `EmbedTheme` |
| Re-exports | `setApiBase`, `setApiToken`, `FetchLike`, `setThemePref`, `getThemePref`, `detectHostTheme`, `ThemePref`, `ResolvedTheme` | `setApiBase`, `setThemePref`, `getThemePref`, `ThemePref`, `ResolvedTheme` | same as wh | same as wh | same as wh |
| Initial scope prop | `initialApplicationKey` | `initialProjectKey`, `initialEnvironmentKey` | `initialTenant` | `initialTenant` | – |

- **Runtime contracts:**
  - the wrapper class `.xtandard-<p>`;
  - the global `window.__<P>_CONFIG__`;
  - the localStorage key `xtandard-<p>:theme`;
  - token prefixes `whpt_`, `audpt_`, `lvt_` and `entpt_`;
  - `?token=` (en also accepts `#token=`).

### A10. `src/react.tsx` embeds

LOC: wh 242, fl 169, au 245, li 256, en 220 (`react-embed.tsx`) + 27 (`entry-react-embed.ts`). Status:
- **au** ≡ wh except docs and the `initialTenant` rename.
- **en** ≡ wh's body refactored into an internal `Embed({portal})`. It has no initial-scope prop and passes `forcePortal`.
- **li** ≡ wh plus two generic improvements nobody else has:
  - the memory router keeps a **`searchHook`** (`memoryLocation().searchHook`), so query-string state such as the tenant survives `routing:"memory"`. In wh, au and en, `routing:"memory"` drops the query string, so `?app=`/`?tenant=` can't be held in memory mode;
  - the token component **calls `client.invalidateQueries()` when the token changes**. In wh, au and en, `setApiToken` changes the token but cached data from the old scope stays on screen.
  - li's token component also defaults to `routing="memory"`.
- **fl** has no portal. It uses `ThemeProvider` instead of the local `useEmbedTheme`, and its re-exports are narrower.

The shared embed logic (about 120 lines) is:
- `setApiBase` with credentials and fetch, run synchronously;
- the `useEmbedTheme` / ThemeProvider;
- the fallback QueryClient singleton;
- `setPortalContainerRef(wrapperRef)`;
- the routing resolver (`hash`|`browser`|`memory`|hook);
- the wrapper `<div data-theme className="xtandard-<p> …">` with `ToastProvider` *inside* it;
- the token component (`setApiToken` synchronously plus an effect).

**Kit:** `createEmbed({ App, scopeClass, appProps })` → `{Dashboard, TokenEmbed}`, using li's routing and invalidation and fl's theme store.

**Fix matrix for the embed and its CSS:**

| Fix | wh | fl | au | li | en |
|---|---|---|---|---|---|
| c1f27b3 / fl cc2141e: scope the embed CSS + portals (scope-embed-css.ts chained in `build:react`, portal-container, wrapper class) | has | has | has | has | has (`xtandard-entitlements:package.json` build:react) |
| 986ad99 / fl de6600e: one theme per embed, `data-theme` on the wrapper, `:root[…]` and `body` moved onto the wrapper, Toasts inside the wrapper, `inherit`/`light`/`dark` modes | has | has (richer) | has | has | has (`xtandard-entitlements:src/react-embed.tsx:51-75,174-184`) |
| ↳ unit test for the scoping transform (`test/embed-css.test.ts`) | has (84) | has (88) | has (84) | has (84) | **lacks**: no embed-css test; covered only by the e2e `embed.spec.ts` |
| ↳ e2e theme spec | `e2e/embed.spec.ts` (7 tests) | `e2e/embed-theme.spec.ts` (5) | `embed.spec.ts` (8) | `embed.spec.ts` (8) | `embed.spec.ts` (6) + `portal.spec.ts` |
| ↳ CodeMirror colours from theme tokens | has | has (classHighlighter) | has | n/a | n/a |
| memory-router searchHook | lacks | lacks | lacks | **has** | lacks |
| invalidate queries on token swap | lacks | n/a | lacks | **has** | lacks |
| strip the token from the URL (`takeTokenFromUrl`) | lacks | n/a | lacks | lacks | **has** |
| portal waits for /config | **lacks** | n/a | has | has | has (alt.) |

### A11. `scripts/scope-embed-css.ts`

LOC: wh 88, fl 89, au 88, li 88, en 88. au, li and en ≡ wh; fl differs.
- **fl** re-homes *any* compound root selector, `/^(?::root|html)([[:.].*)$/`, so `:root.dark` and `:root:not(…)` are handled. wh only handles `[`-qualified ones. fl also folds `body` into the same regex as `:root|html|:host`.
- **Best:** fl's transform with wh's comments.
- **Kit:** `scopeCss(css, scope)` and `findUnscopedLeaks(css, scope)`, parametrised by `SCOPE` (today a constant `.xtandard-<p>`) and `CSS_PATH`, plus a small CLI. It needs `postcss`, `postcss-prefix-selector` and the ambient types in `scripts/vendor.d.ts` (byte-identical, 19 LOC ×5).

### A12. Vite configs and UI tsconfigs

- **`vite.ui.config.ts`** (18 ×5): ≡names. en and fl change comments only.
  - **fl's comment says `emptyOutDir:false`, but the code has `true`** (`xtandard-flags:vite.ui.config.ts:8,15`).
- **`vite.react.config.ts`**: wh 31, fl 26, au 31, li 31, en 35. Same config; en uses `entry src/entry-react-embed.ts` and `fileName react-embed.js`.
- **`tsconfig.react.json`** (13 ×5): `include` differs. wh/li have `src/react.tsx`; fl adds `src/css-modules.d.ts`; au adds `src/ui/assets.d.ts`; en uses `src/entry-react-embed.ts`.
- **Kit:** `defineUiConfig({root})` and `defineEmbedConfig({entry, fileName})` factories, plus a `tsconfig.react.base.json`.

### A13. UI tests

| Test | wh | fl | au | li | en |
|---|---|---|---|---|---|
| `test/ui-lib.test.ts` (product `format.ts` helpers) | 169 | – | 446 | 544 | 488 (+ takeTokenFromUrl) |
| `test/embed-css.test.ts` | 84 | 88 | 84 | 84 | **–** |
| `test/react-embed.test.ts` (exports and props compile) | 61 | – | 61 | 57 | – (en has `react.test.tsx`, `react.test-d.ts`, `react-compute.test.ts` for the hooks package) |
| `test/theme.test.ts` | – | 80 | – | – | – |
| `test/ui-variants.test.ts`, `cors-embed.test.ts` | – | fl only | – | – | – |
| `playwright.config.ts` | 31 | 31 | 32 | 32 | 32 |
| `e2e/ui.spec.ts` | 187 | 294 | 260 | 273 | 183 |
| `e2e/server.ts` | 155 | – (boots `apps/standalone`) | 241 | 21 (wraps `scripts/demo-app.ts`) | 155 |
| `e2e/embed-host.tsx` | 28 | `embed-host/main.tsx` 26 (built to the gitignored `e2e/.embed-host/`) | 53 | 50 | 104 |

- Playwright config drift: ports (wh, au, li 3311; fl 3310; en 3411), webServer timeout (wh, fl, li 120s; au, en 300s), en `workers:1`, and the webServer command (fl boots the standalone app with env vars; en runs the full `bun run build`).
- **Kit:**
  - `definePlaywrightConfig({port, serverCmd})`;
  - a generic `embed-css.test` (taking the scope) and the `theme.test` from fl;
  - the theme e2e cases (class host, data-theme host, prefers-color-scheme fallback, the switcher only theming the panel, forced light/dark) as a reusable spec helper taking a mount URL.

---

## B. Docs site (`site/**`)

| File | wh | fl | au | li | en | Status |
|---|---|---|---|---|---|---|
| `site/scripts/typedoc-plugin.ts` | 87 | 87 | 87 | 87 | 87 | ≡names (au: header comment only). **Kit as is.** |
| `site/scripts/api-overviews.ts` | 249 | 250 | 250 | 249 | 249 | au, li, en ≡ wh; fl diverged (below) |
| `site/scripts/sync.ts` | 436 | 454 | 462 | 436 | 438 | li ≡ wh; fl, au, en extended (below) |
| `site/manifest.ts` | 242 | 406 | 315 | 295 | 300 | generic head (repo/package/site origin, entries) plus a product sidebar |
| `site/astro.config.ts` | 154 | 164 | 164 | 161 | 153 | template plus product strings (description, apiOwners, tagline) |
| `site/package.json` | 28 ×5 | | | | | ≡ except the dev port (wh 4323, fl 4322, au 4326, li 4331, en 4324); same pinned deps (astro 7.4.13, starlight 0.43.1, starlight-typedoc 0.23.2, typedoc 0.28.20…) |
| `site/typedoc.main.tsconfig.json` | 8 ×5 | | | | | byte-identical |
| `site/typedoc.elysia2.tsconfig.json` | 12 ×5 | | | | | ≡names |
| `site/typedoc.tsconfig.json` | 13 | 11 | 13 | 13 | 10 | **en references only `main`**, so there is no Elysia 2 program and `/api/elysia2/` is documented against Elysia 1 types |
| `site/tsconfig.json` | 6 | 7 | 6 | 6 | 6 | fl adds `strict:true` (redundant) |
| `site/src/content.config.ts` | 10 ×5 | | | | | byte-identical |
| `site/.gitignore` | 6 | 8 | 8 | 6 | 6 | fl and au also ignore `/public/` (generated by sync) |
| `site/src/styles/brand.css` | 63 | 55 | 70 | 70 | 55 | wh ≡ fl ≡ en palette (lime-400 on charcoal); fl and en lack the "screenshots" img rule; au and li have their own greys and limes |
| `site/content/index.mdx` | 270 | 284 | 276 | 291 | 186 | product content |

**Divergences that matter:**
- **`api-overviews.ts` (fl):**
  - uses `apiEntries()`/`name` instead of `entries()`/`module`;
  - sorts modules in **package.json `exports` order** rather than root-first then alphabetical;
  - handles `{@link…}` plus `|label` more fully when turning it into code spans;
  - detects re-exports with `/^export\s[^;]*?\bfrom/m`, which also matches `export * as ns from`.
  - wh, au, li and en use `/\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from/`. Both versions carry fix e98d7db ("only `export … from` counts").
- **`sync.ts`:**
  - **fl and au** copy `docs/assets/{favicon.svg,favicon.ico,apple-touch-icon.png,social.png}` into a gitignored `site/public/`, so docs/assets stays the single copy. wh, li and en commit `site/public/` (via `brand-assets.sh`).
  - **fl** adds per-page `description`, skips thematic breaks in the description extractor, generalises section-splitting to any guide (`dropsH2`), and ignores `docs/api/`.
  - **au** adds `pendingPages()`: a link to a guide that doesn't exist yet goes to GitHub with a warning.
  - **en** adds `pending: Record<src, slug>`: a link to a missing guide goes to a fallback site page.
  - Two incompatible "pending" designs exist (au's and en's).
- **`astro.config.ts`:**
  - fl and au **validate `apiOwners`** (`throw` if one isn't an entry point) and add `og:image:alt`;
  - fl and au declare favicon sizes `16x16 32x32 48x48` (wh: `32x32`);
  - wh and others keep `theme-color #0f1215`, which fl and au dropped;
  - fl hard-codes the title instead of using `packageName`;
  - fl dropped `errorOnLocalLinks:false`.
- **`manifest.ts` entries():** wh, au, li and en try `src/<sub>.ts(x)` before `src/entry-<sub>.ts` for one-segment subpaths. fl tries `entry-*` first.

**Site fix matrix:**

| Fix | wh | fl | au | li | en |
|---|---|---|---|---|---|
| bc53bad / fl 2ada92e / au c8a72c7 / en ed237f2: https og:url, og:image, sitemap (`siteOrigin` http→https) | has `manifest.ts:30` | has `:30` | has `:34` | has (ported without a fix commit) `:31` | has `:30` |
| fl e98d7db: re-export detection only counts `export … from` | has (different regex) | has | has | has | has |

**Kit:** a `@xtandard/kit/site` (or a `create-xtandard-site` preset) containing:
- `typedoc-plugin.ts` and `api-overviews.ts` (fl's version);
- `sync.ts` (union of fl and au, with one "pending" design);
- `entries()`/`apiEntries()` (one order);
- a `defineXtandardSite({ packageName, repoSlug, description, tagline, apiOwners, sidebar, devPort, brandCss })` that returns the Astro config;
- the shared typedoc tsconfigs and `content.config.ts`;
- the site `package.json` deps as one pinned set.

Product-specific: the sidebar/IA, `apiOwners`, the description and tagline, `index.mdx` and the brand palette.

---

## C. Repo tooling

### C1. package.json conventions

- **Top-level fields** (same in all 5):
  - `type: module`, `sideEffects:false`;
  - `main dist/index.cjs`, `module dist/index.mjs`, `types dist/index.d.mts`;
  - `bin xtandard-<p>: ./bin/xtandard-<p>.mjs` (en leaves out the `./`);
  - `files [dist, bin, LICENSE, README.md]` (li adds `NOTICE`);
  - `publishConfig.access public`, `engines.node >=20`; `.npmrc` `provenance=true`.
- **Exports layout** (same convention): `"."` is `{import:{types .d.mts, default .mjs}, require:{types .d.cts, default .cjs}}`. Each subpath maps to `src/entry-<path-with-dashes>.ts` (or `src/<sub>.ts`).
  - `./elysia2` takes its types from `dist/types-elysia2/entry-elysia2.d.ts`.
  - `./react` is ESM-only from vite (except en).
  - `./ui/*` and `./package.json` are always present.
  - Common subpaths in all 5: `auth/{basic,delegated,none}`, `authorization/{delegated,none,roles}`, `bun`, `drizzle/{mysql,pg,sqlite}`, `elysia`, `elysia2`, `express`, `hono`, `hooks/log`, `react`, `react/styles.css`, `storage/{cloudflare-kv,drizzle,file,libsql,memory,mongodb,postgres,redis,sqlite,unstorage}`, `testing`, `ui/*`.
- **Peers** are the same pinned set in all 5: `@libsql/client 0.15.15`, `drizzle-orm >=0.44 || >=1.0.0-0`, `elysia ^1||^2.0.0-0`, `express ^4||^5`, `hono ^4`, `mongodb ^5||^6`, `pg ^8`, `react`/`react-dom ^18||^19`, `redis ^4||^5`, `unstorage ^1`. All are optional via `peerDependenciesMeta`. Product extras: fl `@openfeature/server-sdk`, `sift`; au `aws4fetch`; en `@openfeature/server-sdk`.
- **Runtime deps:** `valibot`, `wouter` (plus fl `ohash`, li `uqr`).
- **devDependencies:** 47 shared by all 5, at the same versions. The only shared drift is `mysql2` (`^3.24.6` in wh, au, en; `^3` in fl; `3.24.6` in li). `@codemirror/*` and `@lezer/highlight` are in all but li. The rest are product extras (type-testing, happy-dom, @testing-library, better-auth, sibling `@xtandard/*`…).
- **Scripts.** Identical in all 5:
  - `build` = `build:lib && build:elysia2-types && build:ui && build:react`;
  - `build:lib vp pack`;
  - `build:elysia2-types` (`tsc -p tsconfig.elysia2.build.json && bun scripts/fix-elysia2-types.ts`);
  - `build:ui`, `dev:ui`, `build:react` (vite + scope-embed-css + tsc; en also copies `components.css`);
  - `test vp test run`, `test:coverage`, `test:bun bun test ./test/*.bun.test.ts`, `test:e2e playwright test`;
  - `lint vp lint`, `format`, `format:check`, `typecheck` (tsc + tsc elysia2), `check` (`vp lint && vp fmt --check && bun run typecheck`);
  - `prepare` (`husky || true`), `docs:{dev,build,preview}` (`cd site && …`), `demo`, `typecheck:examples`;
  - `examples:{elysia,hono,express,storage-drivers}`.

  Drift:
  - `release` (`changelogen --release --push`) exists only in fl, li and en; wh and au release by hand, as release.yml documents.
  - `seed:demo` is missing in en, although `scripts/seed-demo.ts` exists there.
  - `typecheck:examples` also checks `examples/elysia2` in fl and en.
  - `standalone` exists only in wh.
  - `screenshots` exists only in li and en.
  - `brand:{masters,assets,check}` exists only in au.
  - fl-only: `docs:api` (typedoc), `e2e:redis`.

### C2. `vite.config.ts` (vite-plus: test, lint, fmt, staged, pack)

LOC: wh 108, fl 117, au 115, li 114, en 126. The shared skeleton:
- the test projects `core` (`test/**/*.test.ts(x)`, excluding `*.bun.test.ts`, `elysia2.test.ts`, e2e and dist) and `elysia2` (alias `elysia → elysia-v2`), `retry: 2`;
- v8 coverage over `src/**/*.ts`, excluding `src/ui/**`, `src/entry-*.ts` and `src/cli.ts`;
- `lint.ignorePatterns [dist, src/ui, apps, examples]`;
- `fmt.ignorePatterns [CHANGELOG.md, site/**/*.mdx]`;
- `staged: {"*.{ts,tsx,md,json,jsonc,yml,yaml,css,html}": ["vp fmt --no-error-on-unmatched-pattern"]}`;
- `pack {entry[], dts, format [esm,cjs], sourcemap, deps.neverBundle [/^bun:/]}`.

Drift:
- Coverage thresholds: wh, fl and au use 92/85/90/92; li 90/80/88/90; en 90/82/90/90. Extra coverage excludes are product-specific.
- li and en lint-ignore `site/**`.
- Extra fmt ignores: au `NOTES-*.md`; en `MISSION.md`.
- fl and en wrap `pack` in an array.
- en adds `typecheck: {enabled, include test/**/*.test-d.ts}` and `elysia2.passWithNoTests`.
- `pack.entry` is a product list. The common entries are `storage-*`, `drizzle-*`, `auth-*`, `authorization-*`, `hooks-log`, `bun`, `elysia(2)`, `express`, `hono`, `cli`.

**Kit:** `defineXtandardConfig({ entries, coverage: {thresholds, exclude}, fmtIgnore, lintIgnore })`.

**Tooling fix matrix:**

| Fix | wh | fl | au | li | en |
|---|---|---|---|---|---|
| fl 8810808: CHANGELOG.md excluded from fmt | has | has | has | has | has |
| fl 8bdb873: `src/cli.ts` excluded from coverage, plus pre-commit/pre-push hooks | has | has | has | has | has |
| au f8b0c4a / li 50445c0: staged fmt doesn't fail on commits touching only mdx or CHANGELOG (`--no-error-on-unmatched-pattern`, no `.mdx` in the glob) | has | has | has | has | has |
| .mdx excluded from fmt (oxfmt mangles `{/* */}`) | has | has | has | has | has |

### C3. TS configs

| File | Status |
|---|---|
| `tsconfig.json` (36 ×5) | byte-identical. ESNext, `module Preserve`, bundler resolution, `allowImportingTsExtensions`, `verbatimModuleSyntax`, strict, `noUncheckedIndexedAccess`, `types:[bun]`; includes src/test/`scripts/vendor.d.ts`; excludes elysia2 files and `*.bun.test.ts`. Kit: `@xtandard/kit/tsconfig.base.json`. |
| `tsconfig.elysia2.json` (14 ×5) | byte-identical |
| `tsconfig.elysia2.build.json` (14 ×5) | ≡names |
| `tsconfig.react.json` (13 ×5) | see A12 |

### C4. Lint, format and hooks

- There are no separate oxlint/oxfmt/biome/eslint/prettier config files. Lint and format are configured only in the `lint`/`fmt`/`staged` blocks of `vite.config.ts` (vite-plus, which wraps oxlint and oxfmt).
- `.husky/pre-commit` (`bunx vp staged`) and `.husky/pre-push` (`bun run check && bun run test && bun run test:bun`) are byte-identical in all 5. Kit: ship them, or a `xtandard-kit hooks install`.
- `mise.toml` pins node 22.22.3 in all 5. Bun is **1.3.14** in wh, fl, au and en but **1.4.4 in li**. li also uses 1.4.4 in ci, pages and release. Kit: one pinned bun version, as a workflow input.

### C5. `scripts/*`

| Script | wh | fl | au | li | en | Status → kit? |
|---|---|---|---|---|---|---|
| `fix-elysia2-types.ts` | 30 | 30 | 30 | 30 | 30 | ≡names (only the doc comment names the product) → **kit CLI as is** |
| `vendor.d.ts` | 19 | 19 | 19 | 19 | 19 | byte-identical → kit |
| `scope-embed-css.ts` | 88 | 89 | 88 | 88 | 88 | see A11 → kit |
| `example.ts` (example runner) | 139 | 159 | 155 | 142 | 213 | Runner body ≡ in wh, fl, au and li apart from cosmetic changes: fl uses ℹ︎/▶ glyphs, au drops `panelPath`, li renames `panelPath`→`path` and drops `seed`. **en refactored it**: exported `ExampleConfig` and `EXAMPLES`, `runExample()`, `all --demo`, an `ELYSIA2` tsconfig override. → kit runner = en's shape, with the `EXAMPLES` table supplied by the product. |
| `demo.ts` | 76 | 64 | 189 | 43 | 30 | product (boots its standalone server + seed) |
| `seed-demo.ts` | 242 | 572 | 1127 | 1104 | 824 | product data |
| `screenshots.ts` | – | – | – | 178 | 104 | Playwright screenshot helper (2× → downscale, oxipng). Kit candidate as a helper; the shot list stays per product. |
| `brand-assets.sh` | 43 | 35 | 88 | 90 | 22 | diverged. Every copy needs rsvg-convert, magick and oxipng. Masters come from `brand-svg.ts` (wh, fl, en) or from `scripts/brand/*.py` via uv (au, li). |
| `brand-svg.ts` | 289 | 270 | – | – | 283 | TS lockup generator |
| `scripts/brand/{build,mark,text}.py` | – | – | 311/91/60 | 131/96/73 | – | Python lockup generator |

Brand centring fix (fl f1b90e7 "centre the symbol on the wordmark"; au 058b787; li 50f4039; wh 95399eb/6b1be56 as `docs(brand)`; en d1a43f0/f5eb71b as `brand:`): **all 5 have it**. The rule is baseline − capHeight/2 with Urbanist sCapHeight 0.7. For example `xtandard-webhooks:scripts/brand-svg.ts:211`, `xtandard-entitlements:scripts/brand-svg.ts:217`. Note the wh and en fixes are not `fix` commits.

**Kit:** one brand generator, preferably the TS one since the toolchain is Bun. Parameters: wordmark text, symbol, palette.

### C6. GitHub workflows (what a reusable `workflow_call` would take as inputs)

| Workflow | wh | fl | au | li | en | Status |
|---|---|---|---|---|---|---|
| `ci.yml` | 114 | 114 | 114 | 128 | 112 | same two jobs: `build` (services redis, mongo, postgres, mysql → typecheck, typecheck:examples, lint, format:check, test:coverage, test:bun, build, publint, `bun pm pack --dry-run`) and `browser-e2e` (install chromium → `test:e2e`) |
| `docker.yml` | 68 | 68 | 68 | 69 | **–** | build+push to GHCR from `apps/standalone/Dockerfile`, then a smoke test of `/healthcheck` and `/` |
| `pages.yml` | 79 | 80 | 79 | 79 | 79 | ≡ (fl: comments; li: bun version) |
| `release.yml` | 85 | 80 | 85 | 85 | 85 | tag → bun build → publint → `npm publish --provenance` (OIDC trusted publishing) → GitHub release. wh, au, li and en take the notes from the CHANGELOG section plus a compare link; **fl** uses `--generate-notes` and edits a changelogen draft. |

Drift and gaps:
- **en has no `docker.yml`**, although `apps/standalone/Dockerfile` exists.
- **en's CI skips `typecheck:examples`**, although the script exists.
- The mysql health-cmd differs in fl, li and en.
- en uses `redis:8` (RedisJSON); li adds a `clickhouse` service.
- li uses bun 1.4.4.
- docker smoke: li probes `/<p>/` and `/<p>/api/openapi.json` instead of `/`.

**Reusable workflow inputs:**
- `ci.yml`:
  - `bun-version`;
  - `services` (bool flags: redis + image tag, mongo, postgres, mysql, clickhouse) with matching env URLs;
  - `db-name` (`POSTGRES_DB`/`MYSQL_DATABASE` = product);
  - `typecheck-examples: bool`, `e2e: bool`;
  - `extra-env`.
- `docker.yml`: `dockerfile` (default `apps/standalone/Dockerfile`), `image-name`, `smoke-paths` (list, default `/healthcheck /`), `smoke-env` (`AUTH_MODE=none`).
- `pages.yml`: `bun-version`, `site-dir` (`site`), `paths` filter.
- `release.yml`: `bun-version`, `node-version` (24), `notes: changelog|generate`.

Secrets: none, since GITHUB_TOKEN and OIDC are enough. Permissions are declared by the caller (`packages: write`, `pages: write`, `id-token: write`).

### C7. CLAUDE.md and `docs/` conventions

- **CLAUDE.md** (wh 23, fl 25, au 50, li 34, en 37):
  - all are an H1 and a one-line gate (`bun run check && bun run test`, plus `test:bun` in au) followed by a `## Docs Site` section;
  - the Docs Site section is ≈80% shared text: README/docs are the source of truth, sync.ts and manifest rules, `@module` per entry, `docs:*` scripts, mdx excluded from fmt;
  - au adds `## Invariants` (product) and `## Shared machine`.
  - The kit could ship the Docs Site section as a shared snippet.
- **Shared docs** in `docs/` (normalised diff vs wh in brackets):
  - in all 5: `ADAPTERS` (117–363), `ARCHITECTURE` (72–217), `AUTH` (18–152), `AUTHORIZATION` (75–206), `BRAND` (140–280), `DEPLOYMENT` (102–295), `GETTING_STARTED` (131–397), `HOOKS` (65–323), `RELEASES` (16–111), `STORAGE` (175–557), `TESTING` (90–202), `UI` (68–269);
  - `ADR/0001-single-package-subpath-exports` in 5 (36–49);
  - `ADR/0003-bundled-spa-ui` in wh, fl, au, li (33–37);
  - `ADR/0006-portal-tokens` in wh and au; en has the equivalent `0010-ui-and-portal-tokens`;
  - `PORTAL` in wh, au, en; `HTTP_API` in au, li, en; `OPENFEATURE` in fl, en.
  - Everything has drifted heavily into product prose. The most kit-able are the generic halves of `RELEASES`, `TESTING`, `AUTH`, `AUTHORIZATION`, `STORAGE` (driver matrix) and `UI` (embed/theme/routing/CSS scope), plus `BRAND` (family rules).
  - `docs/assets/` holds the brand kit and screenshots, per product.

---

## D. Summary: what to build once in the kit

1. **`@xtandard/kit/ui`**:
   - primitives, ui-bits, Toast and ThemeToggle as they are;
   - `cn`, nav-guard, portal-container, assets.d.ts;
   - `theme` (fl's API + wh's guards) and `ThemeProvider`;
   - `createApiClient`;
   - `takeTokenFromUrl`;
   - the shell frame and `useShellConfig` (with the portal-waits-for-config rule);
   - shared bits (Spinner, LoadingRow, Mono, PageHeader, SectionCard, ModalDialog, ConfirmDialog, EmptyCard, Drawer, Page, CopyButton, StatCard) and the format basics;
   - `BrandMark` (data-URL SVG);
   - the base `styles.css` with brand-token overrides.
   - Seams: product name/scope class, the config global, the theme storage key, the accent tokens, the error class.
2. **`@xtandard/kit/react-embed`**: a `createEmbed` factory using li's routing and invalidation, fl's theme and en's portal flag.
3. **`@xtandard/kit/build`**:
   - `scope-embed-css` (fl's transform, scope as a parameter);
   - `fix-elysia2-types`, `vendor.d.ts`;
   - vite-plus / vite UI and embed config factories;
   - the tsconfig bases;
   - the example runner (en's shape);
   - the playwright config factory and the reusable theme e2e and embed-css tests.
4. **`@xtandard/kit/site`**: sync, typedoc-plugin, api-overviews, `defineXtandardSite`, the typedoc tsconfigs and pinned deps.
5. **`.github` reusable workflows**: ci, docker, pages and release, with the inputs listed in C6. Ship husky hooks and pin `mise.toml` in one place.
6. **Gaps to close during the migration:**
   - wh: the portal /config race;
   - en: no embed-css unit test, no docker.yml, CI skips `typecheck:examples`, `/api/elysia2` built against Elysia 1 types, no `seed:demo` script;
   - au: index.html lacks the .ico and apple-touch-icon;
   - fl: the `vite.ui.config.ts` comment contradicts the code, and the `subscribeHostTheme` guard is gone;
   - li: off-pinned bun (1.4.4);
   - wh, au, en: no token invalidation, no memory searchHook, and the token stays in the URL.
