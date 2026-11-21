/**
 * The theme store (keyed per product) and host-theme detection for the embed's `theme="inherit"`:
 * the host's explicit signal (class / data attribute / inline color-scheme on <html>, then <body>)
 * wins over the OS preference.
 *
 * @module
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createThemeStore,
  detectHostTheme,
  resolveTheme,
  subscribeHostTheme,
  type ThemeSignalSource,
} from "../src/ui/theme.ts";

function el({
  classes = [],
  attrs = {},
  colorScheme,
}: {
  classes?: string[];
  attrs?: Record<string, string>;
  colorScheme?: string;
} = {}): ThemeSignalSource {
  return {
    classList: { contains: (t) => classes.includes(t) },
    getAttribute: (n) => attrs[n] ?? null,
    style: { colorScheme },
  };
}

/** A controllable `matchMedia`: `set(dark)` flips the OS scheme and fires `change`. */
function osPrefers(dark: boolean) {
  const listeners = new Set<() => void>();
  let current = dark;
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() {
      return current && q.includes("dark");
    },
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }));
  return {
    set(next: boolean) {
      current = next;
      for (const cb of listeners) cb();
    },
    listeners,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
  return data;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectHostTheme", () => {
  it("follows a `dark` class on <html> even when the OS prefers light", () => {
    osPrefers(false);
    expect(detectHostTheme(el({ classes: ["dark"] }), el())).toBe("dark");
  });

  it("follows a `light` class on <html> even when the OS prefers dark", () => {
    osPrefers(true);
    expect(detectHostTheme(el({ classes: ["light"] }), el())).toBe("light");
  });

  it("reads data-theme / data-mode / data-color-scheme", () => {
    osPrefers(false);
    expect(detectHostTheme(el({ attrs: { "data-theme": "dark" } }), el())).toBe("dark");
    expect(detectHostTheme(el({ attrs: { "data-mode": "dark" } }), el())).toBe("dark");
    expect(detectHostTheme(el({ attrs: { "data-color-scheme": "dark" } }), el())).toBe("dark");
  });

  it("reads an inline color-scheme", () => {
    osPrefers(false);
    expect(detectHostTheme(el({ colorScheme: " dark " }), el())).toBe("dark");
  });

  it("falls back to <body>, and <html> wins over <body>", () => {
    osPrefers(false);
    expect(detectHostTheme(el(), el({ classes: ["dark"] }))).toBe("dark");
    expect(detectHostTheme(el({ classes: ["light"] }), el({ classes: ["dark"] }))).toBe("light");
  });

  it("uses the OS preference only when the host sets no signal", () => {
    osPrefers(true);
    expect(detectHostTheme(el(), el())).toBe("dark");
    osPrefers(false);
    expect(detectHostTheme(el(), el())).toBe("light");
    expect(detectHostTheme(null, undefined)).toBe("light");
  });

  it("ignores unrelated data-theme values", () => {
    osPrefers(true);
    expect(detectHostTheme(el({ attrs: { "data-theme": "ocean" } }), el())).toBe("dark");
  });

  it("is light without a DOM or matchMedia (SSR)", () => {
    expect(detectHostTheme()).toBe("light");
  });
});

describe("subscribeHostTheme", () => {
  // Regression (fl dropped wh's guard): a DOM without MutationObserver must not throw.
  it("works without MutationObserver, following only the OS scheme", () => {
    const os = osPrefers(false);
    vi.stubGlobal("document", { documentElement: {}, body: {} });
    vi.stubGlobal("MutationObserver", undefined);
    const cb = vi.fn();
    const off = subscribeHostTheme(cb);
    os.set(true);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    os.set(false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(os.listeners.size).toBe(0);
  });

  it("observes <html> and <body> attributes when MutationObserver exists", () => {
    osPrefers(false);
    const observed: unknown[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal("document", { documentElement: "html", body: "body" });
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe(target: unknown, opts: MutationObserverInit) {
          observed.push([target, opts.attributeFilter]);
        }
        disconnect = disconnect;
      },
    );
    const off = subscribeHostTheme(() => {});
    expect(observed).toEqual([
      ["html", ["class", "style", "data-theme", "data-mode", "data-color-scheme"]],
      ["body", ["class", "style", "data-theme", "data-mode", "data-color-scheme"]],
    ]);
    off();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("is a no-op without a DOM", () => {
    expect(() => subscribeHostTheme(() => {})()).not.toThrow();
  });
});

describe("createThemeStore", () => {
  it("persists under the product's key, and stores don't share state", () => {
    const data = memoryStorage();
    const wh = createThemeStore("xtandard-webhooks:theme");
    const fl = createThemeStore("xtandard-flags:theme");
    wh.setThemePref("dark");
    expect(data.get("xtandard-webhooks:theme")).toBe("dark");
    expect(wh.getThemePref()).toBe("dark");
    expect(fl.getThemePref()).toBe("system");
    expect(wh.storageKey).toBe("xtandard-webhooks:theme");
  });

  it("reads existing stored preferences (stored-data compatibility)", () => {
    memoryStorage({ "xtandard-audit:theme": "light" });
    expect(createThemeStore("xtandard-audit:theme").getThemePref()).toBe("light");
  });

  it("falls back to system for invalid values or unavailable storage", () => {
    memoryStorage({ k: "ocean" });
    expect(createThemeStore("k").getThemePref()).toBe("system");
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    });
    const store = createThemeStore("k");
    expect(store.getThemePref()).toBe("system");
    const cb = vi.fn();
    store.subscribeThemePref(cb);
    expect(() => store.setThemePref("dark")).not.toThrow();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("notifies on set, and on OS changes only while the preference is system", () => {
    memoryStorage();
    const os = osPrefers(false);
    const store = createThemeStore("k");
    const cb = vi.fn();
    const off = store.subscribeThemePref(cb);
    expect(store.getResolvedTheme()).toBe("light");
    os.set(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.getResolvedTheme()).toBe("dark");
    store.setThemePref("light");
    expect(cb).toHaveBeenCalledTimes(2);
    os.set(false);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    store.setThemePref("dark");
    expect(cb).toHaveBeenCalledTimes(2);
    expect(os.listeners.size).toBe(0);
  });

  it("initTheme writes <html data-theme> and follows changes", () => {
    memoryStorage({ k: "dark" });
    osPrefers(false);
    const dataset: Record<string, string> = {};
    vi.stubGlobal("document", { documentElement: { dataset } });
    const store = createThemeStore("k");
    const off = store.initTheme();
    expect(dataset.theme).toBe("dark");
    store.setThemePref("light");
    expect(dataset.theme).toBe("light");
    off();
    store.setThemePref("dark");
    expect(dataset.theme).toBe("light");
  });

  it("initTheme is a no-op without a DOM", () => {
    expect(() => createThemeStore("k").initTheme()()).not.toThrow();
  });

  it("resolveTheme maps system through the OS", () => {
    osPrefers(true);
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });
});
