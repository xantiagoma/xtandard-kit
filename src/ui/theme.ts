/**
 * Theme preference: `system` (follows the OS), `light`, or `dark`. The preference is persisted in
 * localStorage under a product key (`xtandard-<product>:theme`, passed to {@link createThemeStore});
 * `system` live-updates when the OS scheme changes. The standalone SPA writes the resolved value to
 * `<html data-theme>` (see {@link ThemeStore.initTheme}); the React embed writes it to its own
 * wrapper instead, so it never touches the host document.
 *
 * Host detection ({@link detectHostTheme}, {@link subscribeHostTheme}) is key-free: it reads the
 * page, not a preference.
 *
 * @module
 */

/** A theme preference: `system` follows the OS. */
export type ThemePref = "system" | "light" | "dark";

/** A concrete theme — what every surface, text color and viewer resolves to. */
export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function darkQuery(): MediaQueryList | undefined {
  return typeof matchMedia !== "undefined" ? matchMedia(DARK_QUERY) : undefined;
}

function prefersDark(): boolean {
  return darkQuery()?.matches ?? false;
}

/** The OS colour scheme right now (`light` when it can't be read, e.g. on the server). */
export function systemTheme(): ResolvedTheme {
  return prefersDark() ? "dark" : "light";
}

/** Call `cb` when the OS colour scheme flips. Returns the unsubscribe function. */
export function subscribeSystemTheme(cb: () => void): () => void {
  const mq = darkQuery();
  mq?.addEventListener("change", cb);
  return () => mq?.removeEventListener("change", cb);
}

/** The concrete theme a preference resolves to right now. */
export function resolveTheme(pref: ThemePref): ResolvedTheme {
  return pref === "system" ? systemTheme() : pref;
}

/** A persisted theme preference, bound to one localStorage key. */
export interface ThemeStore {
  /** The localStorage key the preference lives under. */
  readonly storageKey: string;
  /** The stored preference (`system` when unset, invalid, or storage is unavailable). */
  getThemePref(): ThemePref;
  /** Persist `pref` and notify subscribers. */
  setThemePref(pref: ThemePref): void;
  /** The concrete theme the stored preference resolves to right now. */
  getResolvedTheme(): ResolvedTheme;
  /**
   * Subscribe to changes of the resolved preference theme — an explicit {@link setThemePref} or,
   * under `system`, the OS scheme flipping. Returns the unsubscribe function
   * (`useSyncExternalStore`-compatible).
   */
  subscribeThemePref(cb: () => void): () => void;
  /**
   * Standalone SPA only: apply the stored preference to `<html data-theme>` and keep it in sync
   * (toggle + OS changes). Call once at boot, before first paint. Returns the unsubscribe function.
   * The React embed does not call this — it themes its own wrapper.
   */
  initTheme(): () => void;
}

/**
 * Create the theme store for one product. `storageKey` is the product's localStorage key
 * (`"xtandard-webhooks:theme"`…); it is a stored-data contract, so products pass it explicitly.
 */
export function createThemeStore(storageKey: string): ThemeStore {
  const listeners = new Set<() => void>();

  const getThemePref = (): ThemePref => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "light" || v === "dark" || v === "system") return v;
    } catch {
      /* storage unavailable (SSR, privacy mode) */
    }
    return "system";
  };

  const setThemePref = (pref: ThemePref): void => {
    try {
      localStorage.setItem(storageKey, pref);
    } catch {
      /* storage unavailable: the in-memory notification still applies it */
    }
    for (const cb of listeners) cb();
  };

  const getResolvedTheme = (): ResolvedTheme => resolveTheme(getThemePref());

  const subscribeThemePref = (cb: () => void): (() => void) => {
    listeners.add(cb);
    const mq = darkQuery();
    const onOs = () => {
      if (getThemePref() === "system") cb();
    };
    mq?.addEventListener("change", onOs);
    return () => {
      listeners.delete(cb);
      mq?.removeEventListener("change", onOs);
    };
  };

  const initTheme = (): (() => void) => {
    if (typeof document === "undefined") return () => {};
    const apply = () => {
      document.documentElement.dataset.theme = getResolvedTheme();
    };
    apply();
    return subscribeThemePref(apply);
  };

  return {
    storageKey,
    getThemePref,
    setThemePref,
    getResolvedTheme,
    subscribeThemePref,
    initTheme,
  };
}

/** The bits of an element {@link detectHostTheme} reads (keeps it testable without a DOM). */
export interface ThemeSignalSource {
  classList: { contains(token: string): boolean };
  getAttribute(name: string): string | null;
  style?: { colorScheme?: string };
}

/** The attributes {@link detectHostTheme} reads, in order. */
const THEME_ATTRIBUTES = ["data-theme", "data-mode", "data-color-scheme"] as const;

function explicitTheme(el: ThemeSignalSource | null | undefined): ResolvedTheme | undefined {
  if (!el) return undefined;
  // Class strategy (Tailwind `darkMode: "class"`, next-themes `attribute="class"`, …).
  if (el.classList.contains("dark")) return "dark";
  if (el.classList.contains("light")) return "light";
  // Attribute strategy (`data-theme`, also `data-mode` / `data-color-scheme`).
  for (const attr of THEME_ATTRIBUTES) {
    const v = el.getAttribute(attr);
    if (v === "dark" || v === "light") return v;
  }
  // An inline `color-scheme: dark` (next-themes sets it alongside the class).
  const cs = el.style?.colorScheme?.trim();
  if (cs === "dark" || cs === "light") return cs;
  return undefined;
}

/**
 * The host page's theme, for `theme="inherit"`: an explicit signal on `<html>` (then `<body>`) — a
 * `dark`/`light` class, a `data-theme`/`data-mode`/`data-color-scheme` attribute, or an inline
 * `color-scheme` — and, only when the host sets none, the OS `prefers-color-scheme`.
 *
 * Pass `root`/`body` to read other elements (tests, iframes); they default to the document's.
 */
export function detectHostTheme(
  root: ThemeSignalSource | null | undefined = typeof document !== "undefined"
    ? document.documentElement
    : undefined,
  body: ThemeSignalSource | null | undefined = typeof document !== "undefined"
    ? document.body
    : undefined,
): ResolvedTheme {
  return explicitTheme(root) ?? explicitTheme(body) ?? systemTheme();
}

/**
 * Watch the host page for theme switches: class/attribute/style changes on `<html>` and `<body>`,
 * plus the OS scheme. Returns the unsubscribe function. Without a DOM or `MutationObserver` (SSR,
 * old test environments) it only follows the OS scheme.
 */
export function subscribeHostTheme(cb: () => void): () => void {
  const offOs = subscribeSystemTheme(cb);
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return offOs;
  const observer = new MutationObserver(cb);
  const opts: MutationObserverInit = {
    attributes: true,
    attributeFilter: ["class", "style", ...THEME_ATTRIBUTES],
  };
  observer.observe(document.documentElement, opts);
  if (document.body) observer.observe(document.body, opts);
  return () => {
    observer.disconnect();
    offOs();
  };
}
