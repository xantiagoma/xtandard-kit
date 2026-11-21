# UI

The admin shell every xtandard product ships, written once. A product keeps its views, tabs and
scope switcher; the kit supplies the shell, the primitives, the theme, the API client and the embed
plumbing (ADR 0008).

| Subpath                       | What it is                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@xtandard/kit/ui`            | components, theme store, `createApiClient`, `takeTokenFromUrl`, `bootSpa`, `ShellFrame`, bits, format       |
| `@xtandard/kit/ui/embed`      | `createEmbed({ App, scopeClass, api, themeKey })` → `{ Dashboard, TokenEmbed }`                             |
| `@xtandard/kit/ui/styles.css` | the base tokens and layers, plus `@source` lines so Tailwind generates the kit's classes in the product CSS |

Both are compiled ESM. `react`, `react-dom`, `@base-ui-components/react`, `lucide-react`, `wouter`,
`@tanstack/react-query`, `clsx` and `tailwind-merge` are optional peers; the products already have
them as devDependencies because they bundle them into `dist/ui` and `dist/react.js`.

## Product seams

Everything that differs between products is a parameter. Products pass the values they ship today,
because these are stored-data or public contracts (ADR 0010):

| Seam          | Example (webhooks)          | Where                                                 |
| ------------- | --------------------------- | ----------------------------------------------------- |
| theme key     | `"xtandard-webhooks:theme"` | `createThemeStore`, `bootSpa`, `createEmbed`          |
| config global | `"__WEBHOOKS_CONFIG__"`     | `bootSpa`, `readConfigGlobal`                         |
| scope class   | `"xtandard-webhooks"`       | `createEmbed`, `xtandard-kit scope-embed-css --scope` |
| error class   | `WebhooksApiError`          | `createApiClient({ errorClass })`                     |
| brand tokens  | `--accent`, `--chart-*`     | the product's stylesheet, after the kit's             |
| brand mark    | `symbol.svg?raw`            | `<BrandMark light dark />`                            |

## The API client

```ts
// src/ui/api.ts
import { ApiError, createApiClient } from "@xtandard/kit/ui";

export class WebhooksApiError extends ApiError {
  override name = "WebhooksApiError";
}

const client = createApiClient({ errorClass: WebhooksApiError });
export const { setApiBase, setApiToken, getApiToken, apiUrl } = client;
export type { FetchLike, ApiClientOptions } from "@xtandard/kit/ui";

export const getConfig = () => client.req<WebhooksConfig>("config");
export const listApplications = (q?: string) =>
  client.req<Application[]>(`api/apps${client.query({ q })}`);
export const exportCsv = () => client.send("api/export.csv").then((r) => r.blob());
```

- `req<T>()` parses JSON (an empty body is `undefined`); `send()` returns the raw `Response` for
  blobs, CSV and JWKS.
- Non-2xx responses throw `errorClass(status, body)`. The body always carries the real HTTP
  `status`, and `error` falls back to the status text.
- A string body gets `content-type: application/json`; headers you pass win, in any casing or
  `HeadersInit` shape.
- `toQuery`/`query` skips `undefined`, `null` and `""`, joins arrays with commas and stringifies
  booleans.
- Each product creates its own client, so two products' dashboards on one page don't share a base
  URL or token.

## The standalone SPA

```tsx
// src/ui/main.tsx
import { bootSpa } from "@xtandard/kit/ui";
import { App } from "./App.tsx";
import * as api from "./api.ts";
import "./styles.css";

bootSpa({
  App,
  configGlobal: "__WEBHOOKS_CONFIG__",
  themeKey: "xtandard-webhooks:theme",
  tokenFromUrl: true, // products with a portal
  api,
});
```

`bootSpa` applies the stored theme to `<html data-theme>` before first paint, creates the
QueryClient (`retry: 1`, no refetch on focus), reads `basePath` from the config global, and renders
`App` with browser-history routing inside `ThemeProvider` and `ToastProvider`.

With `tokenFromUrl`, a portal link can carry the token as `#token=…` (preferred: the fragment never
reaches servers or access logs) or `?token=…`. The token is attached to the API client and **removed
from the address bar** with `history.replaceState`, so it isn't bookmarked, shared or sent in a
`Referer` header. A hash route (`#/events`) is left alone.

## The shell

```tsx
// src/ui/App.tsx (sketch)
import {
  BrandMark,
  ConfigError,
  readConfigGlobal,
  ShellFrame,
  useShellConfig,
  useShellNav,
  type ShellAppProps,
} from "@xtandard/kit/ui";
import { Router, Switch, Route } from "wouter";
import symbol from "./brand/symbol.svg?raw";
import symbolLight from "./brand/symbol-light.svg?raw";

export function App({ locationHook, searchHook, base, logoUrl, forcePortal }: ShellAppProps) {
  return (
    <Router hook={locationHook} searchHook={searchHook} base={base}>
      <Shell logoUrl={logoUrl} forcePortal={forcePortal} />
    </Router>
  );
}

function Shell({ logoUrl, forcePortal }: { logoUrl?: string; forcePortal?: boolean }) {
  const shell = useShellConfig({
    getConfig,
    bootstrap: readConfigGlobal<WebhooksConfig>("__WEBHOOKS_CONFIG__"),
    token: getApiToken(),
    forcePortal,
  });
  const go = useShellNav({ stickyParams: ["app", "token"] });
  const apps = useQuery({ queryKey: ["apps"], queryFn: listApps, enabled: shell.adminReady });
  return (
    <ShellFrame
      title={shell.config.title || "@xtandard/webhooks"}
      logoUrl={logoUrl ?? shell.config.logoUrl}
      brandMark={<BrandMark light={symbolLight} dark={symbol} className="h-6 w-auto" />}
      readonly={shell.readonly}
      portal={shell.portal}
      switcher={shell.portal ? null : <AppSwitcher apps={apps.data ?? []} />}
      tabs={TABS.filter((t) => !shell.portal || !t.adminOnly)}
      onNavigate={go}
      fallback={shell.failed ? <ConfigError /> : null}
    >
      {shell.ready ? <Switch>{/* routes */}</Switch> : null}
    </ShellFrame>
  );
}
```

`useShellConfig` carries both fixes for the portal race (wh fetched admin data before `/config`
said "portal"):

- `ready` and `adminReady` stay `false` until `/config` answers. Gate the default route and every
  admin query on them.
- A token (`token: getApiToken()`) or `forcePortal` means portal from the first render, even when
  `/config` rejects the token.

`useShellNav` returns `go(path, params?)`: it consults the nav guard (`setNavBlocker`), keeps the
sticky query params, then applies `params` (`""` removes one).

## Theme

```ts
import { createThemeStore, ThemeProvider, useTheme, ThemeToggle } from "@xtandard/kit/ui";

export const themeStore = createThemeStore("xtandard-webhooks:theme");
export const { getThemePref, setThemePref } = themeStore; // product re-exports keep working
```

- The store persists `system` | `light` | `dark` under the product's key, and
  `subscribeThemePref` also fires when the OS scheme flips while the preference is `system`. Its
  shape works with `useSyncExternalStore`.
- `detectHostTheme(root?, body?)` reads the host page: a `dark`/`light` class, then
  `data-theme` / `data-mode` / `data-color-scheme`, then an inline `color-scheme`, on `<html>` then
  `<body>`, falling back to the OS. `subscribeHostTheme` watches those attributes. Without a DOM or
  `MutationObserver` it only follows the OS (the guard fl had lost).
- `ThemeProvider({ store, mode })` resolves `auto` / `inherit` / `light` / `dark` to one theme and
  gives it, with the store, to `useTheme()`, `ThemeToggle` and `BrandMark`.

## The React embed

```tsx
// src/react.tsx
import { createEmbed, type EmbedBaseProps, type TokenEmbedBaseProps } from "@xtandard/kit/ui/embed";
import { App } from "./ui/App.tsx";
import * as api from "./ui/api.ts";
import "./ui/styles.css";

const embed = createEmbed<{ initialApplicationKey?: string }>({
  App,
  scopeClass: "xtandard-webhooks",
  api,
  themeKey: "xtandard-webhooks:theme",
  tokenRouting: "hash", // keep today's default; links uses "memory"
  displayNames: { dashboard: "WebhooksDashboard", token: "WebhooksPortal" },
});

export const WebhooksDashboard = embed.Dashboard;
export const WebhooksPortal = embed.TokenEmbed;
export const { getThemePref, setThemePref } = embed.themeStore;
export interface WebhooksDashboardProps extends EmbedBaseProps {
  initialApplicationKey?: string;
}
export default WebhooksDashboard;
```

Both components take `apiBaseUrl`, `credentials`, `fetch`, `queryClient`, `theme`, `className`,
`routing` (`hash` | `browser` | `memory` | a wouter hook), `routerBase` and `logoUrl`, plus the
product's own props (`initialTenant`…), which are passed to `App`.

- **One theme per embed.** The resolved theme goes on the wrapper
  (`<div class="xtandard-webhooks" data-theme="dark">`), never on the host document. Toasts and Base
  UI portals render inside the wrapper, so the scoped stylesheet reaches them.
- **Memory routing keeps the query string.** `routing: "memory"` passes the memory router's
  `searchHook`, so scope params such as `?tenant=` survive (it used to drop them everywhere but
  links).
- **Token changes refetch.** `TokenEmbed` attaches the token synchronously, invalidates every query
  when the token changes (a new token may carry a different scope), clears it on unmount, and passes
  `forcePortal` to `App`.

## Styles

The kit stylesheet **replaces** the product's own `@import "tailwindcss"`: it already imports
Tailwind, so the product stylesheet starts with the kit import and must not import Tailwind a second
time (that would emit the preflight and utilities twice, and the later copy would override the
kit's layers).

```css
/* src/ui/styles.css — no `@import "tailwindcss"` here */
@import "@xtandard/kit/ui/styles.css";

:root {
  --accent: oklch(0.53 0.15 131);
  --ring: oklch(0.62 0.17 131);
  --chart-1: oklch(0.62 0.17 131);
}
:root[data-theme="dark"] {
  --accent: oklch(0.85 0.2 128);
  --accent-foreground: oklch(0.2 0.02 130);
}
```

The kit stylesheet imports Tailwind v4 and defines the `dark` variant (`[data-theme="dark"]`), the
`@theme inline` mapping, the light and dark tokens (including `--chart-track` and the `--code-*`
tokens with the `.tok-*` classes for CodeMirror's `classHighlighter`) and the base layer. Its
`@source` lines point at the compiled UI files in `dist/`, so the product's Tailwind build generates
the classes the kit components use. If a bundler resolves the stylesheet somewhere that breaks
those relative paths, add `@source "../node_modules/@xtandard/kit/dist";` to the product stylesheet.

The embed CSS is scoped afterwards with `xtandard-kit scope-embed-css` (see `docs/BUILD.md`).
