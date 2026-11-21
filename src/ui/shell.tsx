/**
 * The admin shell shared by every product: {@link useShellConfig} (the `/config` query, portal and
 * readonly state), {@link useShellNav} (nav-guarded in-app navigation that keeps sticky query
 * params) and {@link ShellFrame} (header, brand, badges, theme toggle, tabs, a switcher slot and the
 * routed content). Views, tabs and switchers stay in the product.
 *
 * @module
 */

import * as React from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useLocation, useSearchParams } from "wouter";
import { Lock } from "lucide-react";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { canLeave } from "./lib/nav-guard.ts";
import { cn } from "./lib/utils.ts";
import { useTheme } from "./theme-context.tsx";

/** The `/config` fields the shell reads. Products extend it with their own. */
export interface ShellConfigBase {
  /** Navbar title (wordmark). */
  title?: string;
  /** Navbar logo image URL (replaces the wordmark). */
  logoUrl?: string;
  /** The panel is read-only: mutating actions are hidden or disabled. */
  readonly?: boolean;
  /** Portal principal (wh/au style). */
  portal?: boolean;
  /** `"portal"` for a portal principal (en style). */
  mode?: string;
  /** Mount path of the panel, from the bootstrap global. */
  basePath?: string;
}

/**
 * Read the bootstrap config the panel handler injects as `window[configGlobal]`
 * (`"__WEBHOOKS_CONFIG__"`…). `{}` when it is missing (dev server, embed, SSR).
 */
export function readConfigGlobal<C extends object = ShellConfigBase>(
  configGlobal: string,
): Partial<C> {
  if (typeof window === "undefined") return {};
  const value = (window as unknown as Record<string, unknown>)[configGlobal];
  return value && typeof value === "object" ? (value as Partial<C>) : {};
}

/** Options for {@link useShellConfig}. */
export interface UseShellConfigOptions<C extends ShellConfigBase> {
  /** Fetch `/config` (the product's API function). */
  getConfig: () => Promise<C>;
  /** The bootstrap config (see {@link readConfigGlobal}); used until `/config` answers. */
  bootstrap?: Partial<C>;
  /** Query key; `["config"]` by default. */
  queryKey?: readonly unknown[];
  /** Stale time in ms; 60 s by default. */
  staleTime?: number;
  /** Render the portal chrome regardless of `/config` (the token embed). */
  forcePortal?: boolean;
  /**
   * The portal/viewer token attached to the API client, if any. A token means portal even before
   * (or when) `/config` fails, so no admin request fires for a token holder.
   */
  token?: string | null;
  /** How a config says "portal"; default: `portal === true` or `mode === "portal"`. */
  isPortal?: (config: Partial<C>) => boolean;
}

/** What {@link useShellConfig} returns. */
export interface ShellConfigState<C extends ShellConfigBase> {
  /** `/config` once loaded, the bootstrap before that. */
  config: Partial<C>;
  /**
   * `/config` has answered. Gate the default route and admin queries on it: the bootstrap can't
   * know a portal principal, so rendering before it would fire requests a portal is denied.
   */
  ready: boolean;
  /** `/config` is still loading and there is no bootstrap title to render the chrome with. */
  loading: boolean;
  /** `/config` failed and there is no bootstrap to fall back on: show an error screen. */
  failed: boolean;
  /** Portal chrome (forced, a token, or `/config` says so). */
  portal: boolean;
  /** Read-only panel. */
  readonly: boolean;
  /** `ready && !portal`: the condition for admin-only queries (`enabled: adminReady`). */
  adminReady: boolean;
  /** The underlying query. */
  query: UseQueryResult<C>;
}

const defaultIsPortal = (c: Partial<ShellConfigBase>) => c.portal === true || c.mode === "portal";

/**
 * The `/config` query plus the shell's derived state, with both portal-race fixes: admin work waits
 * for `/config` (`ready`/`adminReady`), and a token means portal from the first render.
 */
export function useShellConfig<C extends ShellConfigBase>(
  options: UseShellConfigOptions<C>,
): ShellConfigState<C> {
  const bootstrap: Partial<C> = options.bootstrap ?? {};
  const query = useQuery({
    queryKey: options.queryKey ?? ["config"],
    queryFn: options.getConfig,
    staleTime: options.staleTime ?? 60_000,
  });
  const config: Partial<C> = query.data ?? bootstrap;
  const isPortal = options.isPortal ?? defaultIsPortal;
  const portal = Boolean(options.forcePortal) || Boolean(options.token) || isPortal(config);
  const ready = query.isSuccess;
  const hasBootstrap = Boolean(bootstrap.title);
  return {
    config,
    ready,
    loading: query.isLoading && !hasBootstrap && !options.forcePortal,
    failed: query.isError && !hasBootstrap,
    portal,
    readonly: config.readonly ?? false,
    adminReady: ready && !portal,
    query,
  };
}

/** Options for {@link useShellNav}. */
export interface UseShellNavOptions {
  /** Query params that survive navigation (the scope, a portal token…): `["tenant", "token"]`. */
  stickyParams?: readonly string[];
}

/**
 * In-app navigation for the shell: `go(path, params?)` consults the nav guard (a view with unsaved
 * edits can veto the move), carries the sticky params over, then applies `params` (`""` removes
 * one).
 */
export function useShellNav(
  options: UseShellNavOptions = {},
): (path: string, params?: Record<string, string>) => void {
  const [, navigate] = useLocation();
  const [searchParams] = useSearchParams();
  const sticky = options.stickyParams ?? [];
  return (path, params = {}) => {
    if (!canLeave()) return;
    const next = new URLSearchParams();
    for (const key of sticky) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    for (const [key, value] of Object.entries(params)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const search = next.toString();
    navigate(search ? `${path}?${search}` : path);
  };
}

/** One navigation tab. */
export interface ShellTab {
  path: string;
  label: React.ReactNode;
  /** Whether the tab is active for `location`; default: exact for `/`, prefix otherwise. */
  match?: (location: string) => boolean;
}

/** Props for {@link ShellFrame}. */
export interface ShellFrameProps {
  /** Wordmark next to the mark (and the logo's alt text). */
  title: string;
  /** Logo image URL; replaces the mark and the wordmark. */
  logoUrl?: string;
  /** The product mark (e.g. `<BrandMark light={…} />`), shown before the title. */
  brandMark?: React.ReactNode;
  /** Brand click handler (e.g. go home); the brand is not a link without it. */
  onBrandClick?: () => void;
  /** Scope switcher (app, project/env, tenant) or a pinned scope label, after the brand. */
  switcher?: React.ReactNode;
  /** Show the read-only badge. */
  readonly?: boolean;
  /** Show the portal badge. */
  portal?: boolean;
  /** Portal badge text; `"Portal"` by default. */
  portalLabel?: React.ReactNode;
  /** Extra header content, before the badges. */
  headerExtra?: React.ReactNode;
  /** Show the theme toggle; defaults to whether the theme provider owns the theme. */
  showThemeToggle?: boolean;
  /** Navigation tabs; the bar is hidden when there is at most one. */
  tabs?: readonly ShellTab[];
  /** Navigate to a tab (usually `useShellNav()`'s `go`). */
  onNavigate?: (path: string) => void;
  /** Render this full-screen instead of the shell (e.g. a config error). */
  fallback?: React.ReactNode;
  /** The routed content (`<Switch>…</Switch>`). */
  children?: React.ReactNode;
  className?: string;
}

const defaultMatch = (path: string) => (location: string) =>
  path === "/" ? location === "/" : location === path || location.startsWith(`${path}/`);

/** The shared admin chrome: sticky header (brand, switcher, badges, toggle), tabs and content. */
export function ShellFrame({
  title,
  logoUrl,
  brandMark,
  onBrandClick,
  switcher,
  readonly,
  portal,
  portalLabel = "Portal",
  headerExtra,
  showThemeToggle,
  tabs = [],
  onNavigate,
  fallback,
  children,
  className,
}: ShellFrameProps): React.ReactElement {
  const [location] = useLocation();
  const theme = useTheme();
  const toggle = showThemeToggle ?? theme.showToggle;

  if (fallback !== undefined && fallback !== null && fallback !== false) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4 text-center">
        {fallback}
      </div>
    );
  }

  const brand = logoUrl ? (
    <img src={logoUrl} alt={title} className="h-7 max-w-[320px] object-contain" />
  ) : (
    <>
      {brandMark}
      <span className="text-sm font-semibold tracking-tight">{title}</span>
    </>
  );

  return (
    <div
      className={cn(
        "flex h-screen flex-col overflow-hidden bg-background text-foreground",
        className,
      )}
    >
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          {onBrandClick ? (
            <a
              href="#"
              data-testid="shell-brand"
              onClick={(e) => {
                e.preventDefault();
                onBrandClick();
              }}
              className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {brand}
            </a>
          ) : (
            <div data-testid="shell-brand" className="flex shrink-0 items-center gap-2">
              {brand}
            </div>
          )}

          {switcher ? (
            <>
              <span className="select-none text-border">/</span>
              {switcher}
            </>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            {headerExtra}
            {readonly && (
              <span className="flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                <Lock className="size-3" />
                Read-only
              </span>
            )}
            {portal && (
              <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                {portalLabel}
              </span>
            )}
            {toggle && <ThemeToggle />}
          </div>
        </div>

        {tabs.length > 1 && (
          <nav
            className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-2 sm:px-4"
            aria-label="Main navigation"
          >
            {tabs.map(({ path, label, match }) => {
              const active = (match ?? defaultMatch(path))(location);
              return (
                <button
                  key={path}
                  type="button"
                  onClick={() => onNavigate?.(path)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:text-foreground",
                    active
                      ? "relative text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </nav>
        )}
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
    </div>
  );
}

/** The default message for a `/config` failure (pass it as {@link ShellFrameProps.fallback}). */
export function ConfigError(): React.ReactElement {
  return (
    <p className="text-[13px] text-muted-foreground">
      Could not load the panel configuration. Check that the API is reachable and that you are
      signed in.
    </p>
  );
}
