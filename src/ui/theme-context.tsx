/**
 * React bindings for the theme store: {@link ThemeProvider} resolves a {@link ThemeMode} to one
 * concrete theme with `useSyncExternalStore`, and {@link useTheme} hands it (plus whether the
 * dashboard owns the toggle) to any component below, so the toggle never has to be prop-drilled.
 *
 * @module
 */

import * as React from "react";
import {
  detectHostTheme,
  subscribeHostTheme,
  subscribeSystemTheme,
  systemTheme,
  type ResolvedTheme,
  type ThemeStore,
} from "./theme.ts";

/**
 * How the dashboard's theme is decided:
 * - `"auto"` — its own system/light/dark preference (persisted), with the toggle.
 * - `"inherit"` — follow the host page (see {@link detectHostTheme}); no toggle.
 * - `"light"` / `"dark"` — fixed by the host (e.g. from its own theme state); no toggle.
 */
export type ThemeMode = "auto" | "inherit" | ResolvedTheme;

/** What {@link useTheme} returns. */
export interface ThemeState {
  /** The single theme every surface, text color and viewer resolves to. */
  resolved: ResolvedTheme;
  /** Whether the dashboard owns the theme (shows its own toggle). */
  showToggle: boolean;
  /** The product's theme store, when a {@link ThemeProvider} supplied one. */
  store: ThemeStore | undefined;
}

const ThemeContext = React.createContext<ThemeState | null>(null);

const serverLight = (): ResolvedTheme => "light";
const noopSubscribe = () => () => {};
const hostTheme = () => detectHostTheme();

/** Resolve a {@link ThemeMode} against `store`, re-rendering on every relevant change. */
export function useResolvedTheme(store: ThemeStore, mode: ThemeMode): ResolvedTheme {
  // Both stores are always subscribed (hooks can't be conditional); only the one matching `mode`
  // is read.
  const fromPref = useSyncStore(
    mode === "auto" ? store.subscribeThemePref : noopSubscribe,
    store.getResolvedTheme,
  );
  const fromHost = useSyncStore(mode === "inherit" ? subscribeHostTheme : noopSubscribe, hostTheme);
  if (mode === "auto") return fromPref;
  if (mode === "inherit") return fromHost;
  return mode;
}

function useSyncStore(
  subscribe: (cb: () => void) => () => void,
  read: () => ResolvedTheme,
): ResolvedTheme {
  return React.useSyncExternalStore(subscribe, read, serverLight);
}

/** Props for {@link ThemeProvider}. */
export interface ThemeProviderProps {
  /** The product's theme store ({@link createThemeStore}). */
  store: ThemeStore;
  /** How the theme is decided; defaults to `"auto"`. */
  mode?: ThemeMode;
  /** Render prop receiving the resolved theme (e.g. to set `data-theme` on a wrapper). */
  children: (resolved: ResolvedTheme) => React.ReactNode;
}

/** Provide the resolved theme (and the store, for {@link ThemeToggle}) to the subtree. */
export function ThemeProvider({
  store,
  mode = "auto",
  children,
}: ThemeProviderProps): React.ReactElement {
  const resolved = useResolvedTheme(store, mode);
  const value = React.useMemo<ThemeState>(
    () => ({ resolved, showToggle: mode === "auto", store }),
    [resolved, mode, store],
  );
  return <ThemeContext.Provider value={value}>{children(resolved)}</ThemeContext.Provider>;
}

/**
 * The active theme. Outside a {@link ThemeProvider} it follows the OS scheme and reports no toggle
 * (there is no store to persist a choice in).
 */
export function useTheme(): ThemeState {
  const ctx = React.useContext(ThemeContext);
  const fromOs = React.useSyncExternalStore(
    ctx ? noopSubscribe : subscribeSystemTheme,
    systemTheme,
    serverLight,
  );
  return ctx ?? { resolved: fromOs, showToggle: false, store: undefined };
}
