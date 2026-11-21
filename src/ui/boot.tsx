/**
 * The standalone SPA bootstrap (`src/ui/main.tsx` in every product): apply the theme before first
 * paint, take a portal token from the URL, create the QueryClient, read the base path from the
 * config global, and render the product's `App` with browser-history routing.
 *
 * @module
 */

import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BaseLocationHook } from "wouter";
import { useBrowserLocation } from "wouter/use-browser-location";
import type { ApiClient } from "./api-client.ts";
import { ToastProvider } from "./components/Toast.tsx";
import { readConfigGlobal } from "./shell.tsx";
import { createThemeStore, type ThemeStore } from "./theme.ts";
import { ThemeProvider } from "./theme-context.tsx";
import { takeTokenFromUrl } from "./token.ts";

/** The props `bootSpa` (and `createEmbed`) pass to the product's `App`. */
export interface ShellAppProps {
  /** wouter location hook (browser history in the SPA; hash/browser/memory/custom in the embed). */
  locationHook?: BaseLocationHook;
  /** wouter search hook (the memory router's, so the query string survives `routing: "memory"`). */
  searchHook?: () => string;
  /** Router base path. */
  base?: string;
  /** Navbar logo override. */
  logoUrl?: string;
  /** Whether the shell shows its own theme toggle. */
  showThemeToggle?: boolean;
  /** Render the portal chrome regardless of `/config` (the token embed). */
  forcePortal?: boolean;
}

/** A `QueryClient` with the shell's defaults: one retry, no refetch on window focus. */
export function createShellQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  });
}

/** Options for {@link bootSpa}. */
export interface BootSpaOptions<P extends object = object> {
  /** The product's root component. */
  App: React.ComponentType<ShellAppProps & P>;
  /** The global the panel handler injects (`"__WEBHOOKS_CONFIG__"`); its `basePath` is the router base. */
  configGlobal: string;
  /** The theme storage key (`"xtandard-webhooks:theme"`), or an existing store. */
  themeKey: string | ThemeStore;
  /**
   * Take a portal token from `#token=`/`?token=`, strip it from the address bar, and attach it to
   * `api`. Needs `api`. Default `false` (products without a portal).
   */
  tokenFromUrl?: boolean;
  /** The product's API client (for the token). */
  api?: Pick<ApiClient, "setApiToken">;
  /** Extra props for `App`. */
  appProps?: P;
  /** The mount element or its id; `"root"` by default. */
  root?: HTMLElement | string;
  /** Bring your own QueryClient. */
  queryClient?: QueryClient;
  /** Wrap in `React.StrictMode`; default `true`. */
  strictMode?: boolean;
}

/** What {@link bootSpa} returns. */
export interface BootedSpa {
  root: Root;
  queryClient: QueryClient;
  themeStore: ThemeStore;
  /** The token taken from the URL, if any. */
  token: string | null;
}

/** Boot the standalone admin SPA. Call once from the product's `main.tsx`. */
export function bootSpa<P extends object = object>(options: BootSpaOptions<P>): BootedSpa {
  const themeStore =
    typeof options.themeKey === "string" ? createThemeStore(options.themeKey) : options.themeKey;
  // Apply the persisted theme before first paint.
  themeStore.initTheme();

  let token: string | null = null;
  if (options.tokenFromUrl) {
    if (!options.api) throw new Error("bootSpa: `tokenFromUrl` needs the product's `api` client.");
    token = takeTokenFromUrl(window.location, (url) => window.history.replaceState(null, "", url));
    if (token) options.api.setApiToken(token);
  }

  const queryClient = options.queryClient ?? createShellQueryClient();
  const el =
    typeof options.root === "object"
      ? options.root
      : document.getElementById(options.root ?? "root");
  if (!el) throw new Error("Root element not found");

  // The bundled SPA owns its URL, and the panel handler serves a SPA catch-all under the basePath,
  // so it uses real browser-history routing for clean, deep-linkable paths.
  const basePath = (
    readConfigGlobal<{ basePath?: string }>(options.configGlobal).basePath ?? ""
  ).replace(/\/$/, "");

  const { App } = options;
  const appProps = (options.appProps ?? {}) as P;
  const tree = (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider store={themeStore} mode="auto">
        {() => (
          <ToastProvider>
            <App {...appProps} locationHook={useBrowserLocation} base={basePath} />
          </ToastProvider>
        )}
      </ThemeProvider>
    </QueryClientProvider>
  );
  const root = createRoot(el);
  root.render(options.strictMode === false ? tree : <React.StrictMode>{tree}</React.StrictMode>);
  return { root, queryClient, themeStore, token };
}
