/**
 * The React embed factory behind every product's `/react` export. {@link createEmbed} returns a
 * `Dashboard` (the full admin) and a `TokenEmbed` (the same shell scoped by a portal/viewer token),
 * sharing:
 *
 * - the API base set synchronously, so the first queries use it;
 * - one theme per embed, resolved by `ThemeProvider` and applied to the wrapper (`data-theme`), never
 *   to the host document;
 * - a fallback QueryClient singleton per embed factory;
 * - Base UI portals pointed at the scoped wrapper;
 * - routing as `hash` | `browser` | `memory` | a custom hook, where the memory router keeps its query
 *   string (`searchHook`) so scope params like `?tenant=` survive;
 * - the token attached synchronously, with every query invalidated when the token changes;
 * - `forcePortal` for the token component.
 *
 * @module
 */

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BaseLocationHook } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useBrowserLocation } from "wouter/use-browser-location";
import { memoryLocation } from "wouter/memory-location";
import type { ApiClient, FetchLike } from "./api-client.ts";
import { createShellQueryClient, type ShellAppProps } from "./boot.tsx";
import { ToastProvider } from "./components/Toast.tsx";
import { setPortalContainerRef } from "./lib/portal-container.ts";
import { createThemeStore, type ThemeStore } from "./theme.ts";
import { ThemeProvider, type ThemeMode } from "./theme-context.tsx";

/** Theme modes for an embed: `auto` (own toggle), `inherit` (follow the host), or a fixed theme. */
export type EmbedTheme = ThemeMode;

/** How an embed routes between views. */
export type EmbedRouting = "hash" | "browser" | "memory" | BaseLocationHook;

/** The props every embed component accepts (products add their own, e.g. `initialTenant`). */
export interface EmbedBaseProps {
  /** Where the panel API and `/config` are mounted (`"/webhooks"`, `"https://admin.example.com/x"`). */
  apiBaseUrl?: string;
  /**
   * `credentials` mode for API requests (default `"same-origin"`). For a cross-origin embed with
   * cookie auth, use `"include"` and enable `cors` on the panel.
   */
  credentials?: RequestCredentials;
  /** Custom `fetch` (inject headers, instrument calls). */
  fetch?: FetchLike;
  /** Bring your own QueryClient; a shared one is created otherwise. */
  queryClient?: QueryClient;
  /**
   * Theme handling. The embed never writes to the host document; it applies the resolved theme to
   * its own wrapper. `"auto"` (default) shows the panel's own switcher; `"inherit"` follows the host
   * page live; `"light"`/`"dark"` force one.
   */
  theme?: EmbedTheme;
  /** Extra className on the wrapper. */
  className?: string;
  /**
   * `"hash"` (default for the dashboard) never touches the host router; `"browser"` uses real paths
   * under `routerBase`; `"memory"` keeps everything in memory (query string included); or pass a
   * wouter location hook.
   */
  routing?: EmbedRouting;
  /** Base path for `routing: "browser"` (e.g. `"/admin/webhooks"`). */
  routerBase?: string;
  /** Navbar logo image URL (replaces the wordmark). Overrides server `/config`. */
  logoUrl?: string;
}

/** Props of the token component: {@link EmbedBaseProps} plus the token. */
export interface TokenEmbedBaseProps extends EmbedBaseProps {
  /** The portal/viewer token minted server-side, sent as `Authorization: Bearer …`. */
  token: string;
}

/** Options for {@link createEmbed}. */
export interface CreateEmbedOptions<P extends object> {
  /** The product's root component (the same one the SPA renders). */
  App: React.ComponentType<ShellAppProps & P>;
  /** The scope class the embed stylesheet is scoped under (`"xtandard-webhooks"`, no dot). */
  scopeClass: string;
  /** The product's API client. */
  api: Pick<ApiClient, "setApiBase" | "setApiToken">;
  /** The theme storage key (`"xtandard-webhooks:theme"`), or an existing store. */
  themeKey: string | ThemeStore;
  /** Default routing of the token component; `"memory"` by default. */
  tokenRouting?: EmbedRouting;
  /** Component display names (`{ dashboard: "WebhooksDashboard", token: "WebhooksPortal" }`). */
  displayNames?: { dashboard?: string; token?: string };
}

/** What {@link createEmbed} returns. */
export interface Embed<P extends object> {
  /** The full admin dashboard. */
  Dashboard: React.FC<EmbedBaseProps & P>;
  /** The token-scoped dashboard (portal / viewer). */
  TokenEmbed: React.FC<TokenEmbedBaseProps & P>;
  /** The theme store the embed uses (for re-exporting `getThemePref`/`setThemePref`). */
  themeStore: ThemeStore;
}

/** The wouter hooks for a routing strategy. */
interface ResolvedRouting {
  hook: BaseLocationHook;
  searchHook: (() => string) | undefined;
  base: string;
}

/** Resolve an {@link EmbedRouting} to wouter hooks; `memory` is created once per mount. */
export function useEmbedRouting(routing: EmbedRouting, routerBase = ""): ResolvedRouting {
  // The memory location is created once so its history (and query string, which carries the scope)
  // survives re-renders.
  const memory = React.useMemo(() => memoryLocation(), []);
  return React.useMemo(() => {
    if (typeof routing === "function")
      return { hook: routing, searchHook: undefined, base: routerBase };
    if (routing === "browser")
      return { hook: useBrowserLocation, searchHook: undefined, base: routerBase };
    if (routing === "memory") return { hook: memory.hook, searchHook: memory.searchHook, base: "" };
    return { hook: useHashLocation, searchHook: undefined, base: "" };
  }, [routing, routerBase, memory]);
}

/** Build a product's embed components from its `App`, scope class, API client and theme key. */
export function createEmbed<P extends object = object>(options: CreateEmbedOptions<P>): Embed<P> {
  const { App, scopeClass, api } = options;
  if (!/^[A-Za-z_-][\w-]*$/.test(scopeClass)) {
    throw new Error(`createEmbed: scopeClass must be a bare class name, got "${scopeClass}".`);
  }
  const themeStore =
    typeof options.themeKey === "string" ? createThemeStore(options.themeKey) : options.themeKey;

  let fallbackClient: QueryClient | undefined;
  const getClient = () => (fallbackClient ??= createShellQueryClient());

  function Shell({
    apiBaseUrl = "",
    credentials,
    fetch: fetchImpl,
    queryClient,
    theme = "auto",
    className,
    routing = "hash",
    routerBase = "",
    logoUrl,
    forcePortal,
    ...rest
  }: EmbedBaseProps & { forcePortal?: boolean } & P): React.ReactElement {
    // Set the API base synchronously so child queries (run on mount) use it.
    api.setApiBase(apiBaseUrl, { credentials, fetch: fetchImpl });
    const client = queryClient ?? getClient();

    // Point Base UI portals (Select/Combobox popups, Dialogs) at the scoped wrapper: the embed
    // stylesheet is scoped, so anything portaled to document.body would be unstyled.
    const wrapperRef = React.useRef<HTMLDivElement>(null);
    setPortalContainerRef(wrapperRef);

    const { hook, searchHook, base } = useEmbedRouting(routing, routerBase);
    const appProps = rest as unknown as P;

    return (
      <QueryClientProvider client={client}>
        <ThemeProvider store={themeStore} mode={theme}>
          {(resolved) => (
            <div
              ref={wrapperRef}
              data-theme={resolved}
              className={className ? `${scopeClass} ${className}` : scopeClass}
            >
              {/* Inside the wrapper so the toast region gets the scoped styles + theme. */}
              <ToastProvider>
                <App
                  {...appProps}
                  locationHook={hook}
                  searchHook={searchHook}
                  base={base}
                  logoUrl={logoUrl}
                  showThemeToggle={theme === "auto"}
                  forcePortal={forcePortal}
                />
              </ToastProvider>
            </div>
          )}
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  const Dashboard: React.FC<EmbedBaseProps & P> = (props) => <Shell {...props} />;

  const TokenEmbed: React.FC<TokenEmbedBaseProps & P> = ({
    token,
    routing = options.tokenRouting ?? "memory",
    ...rest
  }) => {
    // Attach the token synchronously so the first queries send it; the effect keeps it current
    // when the host swaps tokens (re-mint on expiry).
    api.setApiToken(token);
    const client = rest.queryClient ?? getClient();
    const previous = React.useRef(token);
    React.useEffect(() => {
      api.setApiToken(token);
      if (previous.current === token) return;
      previous.current = token;
      // A new token may carry a different scope: refetch everything.
      void client.invalidateQueries();
    }, [token, client]);
    React.useEffect(
      () => () => {
        api.setApiToken(null);
      },
      [],
    );
    const shellProps = { ...rest, routing, queryClient: client, forcePortal: true };
    return <Shell {...(shellProps as EmbedBaseProps & { forcePortal: boolean } & P)} />;
  };

  Dashboard.displayName = options.displayNames?.dashboard ?? "Dashboard";
  TokenEmbed.displayName = options.displayNames?.token ?? "TokenEmbed";
  return { Dashboard, TokenEmbed, themeStore };
}
