// @vitest-environment happy-dom
/**
 * The React layer: `useShellConfig` (portal waits for `/config`; a token means portal), `ShellFrame`
 * + `useShellNav` (nav guard, sticky params), `createEmbed` (scope class, one theme per embed,
 * memory routing keeps the query string, queries invalidated on token change) and `bootSpa`.
 *
 * @module
 */

import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Router, useLocation, useSearchParams } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/ui/api-client.ts";
import { bootSpa, type ShellAppProps } from "../src/ui/boot.tsx";
import { BrandMark } from "../src/ui/components/BrandMark.tsx";
import { ThemeToggle } from "../src/ui/components/ThemeToggle.tsx";
import { createEmbed } from "../src/ui/embed.tsx";
import { clearNavBlocker, setNavBlocker } from "../src/ui/lib/nav-guard.ts";
import {
  ConfigError,
  readConfigGlobal,
  ShellFrame,
  useShellConfig,
  useShellNav,
  type ShellConfigBase,
} from "../src/ui/shell.tsx";
import { createThemeStore } from "../src/ui/theme.ts";
import { ThemeProvider, useTheme } from "../src/ui/theme-context.tsx";

const IS_REACT_ACT_ENVIRONMENT = "IS_REACT_ACT_ENVIRONMENT";
(globalThis as Record<string, unknown>)[IS_REACT_ACT_ENVIRONMENT] = true;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.className = "";
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useShellConfig", () => {
  function Probe(props: {
    getConfig: () => Promise<ShellConfigBase>;
    token?: string | null;
    bootstrap?: ShellConfigBase;
    forcePortal?: boolean;
  }) {
    const s = useShellConfig(props);
    return (
      <output>
        {JSON.stringify({
          ready: s.ready,
          portal: s.portal,
          adminReady: s.adminReady,
          loading: s.loading,
          failed: s.failed,
          readonly: s.readonly,
          title: s.config.title ?? null,
        })}
      </output>
    );
  }
  const state = () => JSON.parse(screen.getByRole("status").textContent!);

  it("is not ready (no admin work) until /config answers — the wh portal race", async () => {
    const d = deferred<ShellConfigBase>();
    render(
      <QueryClientProvider client={client()}>
        <Probe getConfig={() => d.promise} bootstrap={{ title: "Webhooks" }} />
      </QueryClientProvider>,
    );
    expect(state()).toMatchObject({ ready: false, adminReady: false, portal: false });
    expect(state()).toMatchObject({ loading: false, title: "Webhooks" });
    await act(async () => d.resolve({ title: "Webhooks", portal: true, readonly: true }));
    await waitFor(() =>
      expect(state()).toMatchObject({
        ready: true,
        portal: true,
        adminReady: false,
        readonly: true,
      }),
    );
  });

  it("treats a token as portal from the first render (en)", () => {
    render(
      <QueryClientProvider client={client()}>
        <Probe getConfig={() => new Promise(() => {})} token="whpt_x" />
      </QueryClientProvider>,
    );
    expect(state()).toMatchObject({ portal: true, loading: true, adminReady: false });
  });

  it("reads mode: portal and reports failure without a bootstrap", async () => {
    render(
      <QueryClientProvider client={client()}>
        <Probe getConfig={async () => ({ mode: "portal" })} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(state()).toMatchObject({ ready: true, portal: true }));
    cleanup();
    render(
      <QueryClientProvider client={client()}>
        <Probe getConfig={() => Promise.reject(new Error("down"))} forcePortal />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(state()).toMatchObject({ failed: true, portal: true }));
  });

  it("readConfigGlobal reads the product's global", () => {
    (window as unknown as Record<string, unknown>).__X_CONFIG__ = { basePath: "/x" };
    expect(readConfigGlobal("__X_CONFIG__")).toEqual({ basePath: "/x" });
    expect(readConfigGlobal("__MISSING__")).toEqual({});
  });
});

describe("ShellFrame + useShellNav", () => {
  function Shell({ readonly, portal }: { readonly?: boolean; portal?: boolean }) {
    const go = useShellNav({ stickyParams: ["tenant"] });
    const [location] = useLocation();
    const [params] = useSearchParams();
    return (
      <ShellFrame
        title="Audit"
        brandMark={<span data-testid="mark" />}
        onBrandClick={() => go("/")}
        switcher={<span>acme</span>}
        readonly={readonly}
        portal={portal}
        tabs={[
          { path: "/", label: "Overview" },
          { path: "/events", label: "Events" },
        ]}
        onNavigate={(p) => go(p, { event: "" })}
      >
        <p data-testid="loc">{`${location}?${params.toString()}`}</p>
      </ShellFrame>
    );
  }

  it("renders brand, switcher, badges and tabs; navigation keeps sticky params", () => {
    const mem = memoryLocation({ path: "/?tenant=acme&event=e1" });
    const store = createThemeStore("t");
    render(
      <ThemeProvider store={store}>
        {() => (
          <Router hook={mem.hook} searchHook={mem.searchHook}>
            <Shell readonly portal />
          </Router>
        )}
      </ThemeProvider>,
    );
    expect(screen.getByText("Audit")).toBeTruthy();
    expect(screen.getByTestId("mark")).toBeTruthy();
    expect(screen.getByText("acme")).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(screen.getByText("Portal")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Overview" }).getAttribute("aria-current")).toBe(
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: "Events" }));
    expect(screen.getByTestId("loc").textContent).toBe("/events?tenant=acme");
    expect(screen.getByRole("button", { name: "Events" }).getAttribute("aria-current")).toBe(
      "page",
    );
    fireEvent.click(screen.getByTestId("shell-brand"));
    expect(screen.getByTestId("loc").textContent).toBe("/?tenant=acme");
  });

  it("the nav guard can veto navigation", () => {
    const mem = memoryLocation({ path: "/" });
    render(
      <Router hook={mem.hook} searchHook={mem.searchHook}>
        <Shell />
      </Router>,
    );
    const block = () => false;
    setNavBlocker(block);
    fireEvent.click(screen.getByRole("button", { name: "Events" }));
    expect(screen.getByTestId("loc").textContent).toBe("/?");
    clearNavBlocker(block);
    fireEvent.click(screen.getByRole("button", { name: "Events" }));
    expect(screen.getByTestId("loc").textContent).toBe("/events?");
    // No provider: no toggle, no badges.
    expect(screen.queryByRole("group", { name: "Theme" })).toBeNull();
    expect(screen.queryByText("Read-only")).toBeNull();
  });

  it("renders the fallback instead of the shell, and a logo instead of the wordmark", () => {
    const { rerender } = render(
      <Router>
        <ShellFrame title="X" fallback={<ConfigError />} />
      </Router>,
    );
    expect(screen.getByText(/Could not load the panel configuration/)).toBeTruthy();
    rerender(
      <Router>
        <ShellFrame title="X" logoUrl="/logo.png" tabs={[{ path: "/", label: "Only" }]} />
      </Router>,
    );
    expect(screen.getByRole("img", { name: "X" }).getAttribute("src")).toBe("/logo.png");
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("theme components", () => {
  it("ThemeToggle persists through the provider's store and re-resolves", () => {
    const store = createThemeStore("xtandard-flags:theme");
    function Resolved() {
      return <i data-testid="resolved">{useTheme().resolved}</i>;
    }
    render(
      <ThemeProvider store={store}>
        {() => (
          <>
            <ThemeToggle />
            <Resolved />
          </>
        )}
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
    expect(localStorage.getItem("xtandard-flags:theme")).toBe("dark");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark theme" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("ThemeToggle without a store throws a clear error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ThemeToggle />)).toThrow(/needs a `store` prop/);
  });

  it("inherit mode follows the host document live", async () => {
    const store = createThemeStore("k");
    render(
      <ThemeProvider store={store} mode="inherit">
        {(resolved) => <i data-testid="r">{resolved}</i>}
      </ThemeProvider>,
    );
    expect(screen.getByTestId("r").textContent).toBe("light");
    await act(async () => {
      document.documentElement.classList.add("dark");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByTestId("r").textContent).toBe("dark");
  });

  it("BrandMark inlines SVG markup as a data URL, per resolved theme", () => {
    const store = createThemeStore("k");
    store.setThemePref("dark");
    const { container, rerender } = render(
      <ThemeProvider store={store}>
        {() => <BrandMark light="<svg>L</svg>" dark="<svg>D</svg>" />}
      </ThemeProvider>,
    );
    expect(container.querySelector("img")!.getAttribute("src")).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg>D</svg>")}`,
    );
    rerender(<BrandMark light="/mark.svg" />);
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0]!.getAttribute("src")).toBe("/mark.svg");
    expect(imgs[0]!.className).toContain("dark:hidden");
  });
});

describe("createEmbed", () => {
  interface Extra {
    initialTenant?: string;
  }
  const seen: (ShellAppProps & Extra)[] = [];
  function App(props: ShellAppProps & Extra) {
    seen.push(props);
    return (
      <Router hook={props.locationHook} searchHook={props.searchHook} base={props.base}>
        <Inner />
      </Router>
    );
  }
  function Inner() {
    const [location, navigate] = useLocation();
    const [params] = useSearchParams();
    const q = useQuery({ queryKey: ["n"], queryFn: async () => (calls += 1) });
    return (
      <div>
        <p data-testid="where">{`${location}?${params.toString()}`}</p>
        <p data-testid="calls">{String(q.data ?? 0)}</p>
        <button type="button" onClick={() => navigate("/links?tenant=acme")}>
          nav
        </button>
      </div>
    );
  }
  let calls = 0;
  beforeEach(() => {
    seen.length = 0;
    calls = 0;
  });

  it("rejects a selector as the scope class", () => {
    const api = createApiClient();
    expect(() => createEmbed({ App, scopeClass: ".xtandard-x", api, themeKey: "k" })).toThrow(
      /bare class name/,
    );
  });

  it("wraps in the scope class with the resolved theme, and sets the API base synchronously", () => {
    const api = createApiClient();
    const setBase = vi.spyOn(api, "setApiBase");
    const { Dashboard, themeStore } = createEmbed<Extra>({
      App,
      scopeClass: "xtandard-links",
      api,
      themeKey: "xtandard-links:theme",
      displayNames: { dashboard: "LinksDashboard" },
    });
    expect(Dashboard.displayName).toBe("LinksDashboard");
    const { container } = render(
      <Dashboard apiBaseUrl="/links" theme="dark" className="h-96" initialTenant="t1" />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toBe("xtandard-links h-96");
    expect(wrapper.getAttribute("data-theme")).toBe("dark");
    expect(setBase).toHaveBeenCalledWith("/links", { credentials: undefined, fetch: undefined });
    expect(seen[0]).toMatchObject({ initialTenant: "t1", showThemeToggle: false });
    expect(seen[0]!.forcePortal).toBeUndefined();
    expect(themeStore.storageKey).toBe("xtandard-links:theme");
    // The host document is never themed by the embed.
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  // Regression (li fix for wh/au/en): memory routing must keep the query string.
  it("memory routing keeps the query string", () => {
    const { Dashboard } = createEmbed({
      App,
      scopeClass: "x",
      api: createApiClient(),
      themeKey: "k",
    });
    const before = window.location.href;
    render(<Dashboard routing="memory" queryClient={client()} />);
    fireEvent.click(screen.getByRole("button", { name: "nav" }));
    expect(screen.getByTestId("where").textContent).toBe("/links?tenant=acme");
    expect(window.location.href).toBe(before);
  });

  it("browser routing uses the router base; hash is the default", () => {
    const { Dashboard } = createEmbed({
      App,
      scopeClass: "x",
      api: createApiClient(),
      themeKey: "k",
    });
    render(<Dashboard routing="browser" routerBase="/admin" queryClient={client()} />);
    expect(seen.at(-1)!.base).toBe("/admin");
    cleanup();
    render(<Dashboard queryClient={client()} />);
    expect(seen.at(-1)!.base).toBe("");
    expect(seen.at(-1)!.searchHook).toBeUndefined();
  });

  // Regression (li fix for wh/au/en): swapping the token refetches everything.
  it("TokenEmbed attaches the token, forces portal, and invalidates queries on token change", async () => {
    const api = createApiClient();
    const qc = client();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { TokenEmbed } = createEmbed({ App, scopeClass: "x", api, themeKey: "k" });
    const { rerender, unmount } = render(<TokenEmbed token="lvt_1" queryClient={qc} />);
    expect(api.getApiToken()).toBe("lvt_1");
    expect(seen.at(-1)).toMatchObject({ forcePortal: true });
    expect(seen.at(-1)!.searchHook).toBeTypeOf("function"); // memory routing by default
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1"));
    expect(invalidate).not.toHaveBeenCalled();
    rerender(<TokenEmbed token="lvt_2" queryClient={qc} />);
    expect(api.getApiToken()).toBe("lvt_2");
    expect(invalidate).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("2"));
    unmount();
    expect(api.getApiToken()).toBeNull();
  });

  it("shares one fallback QueryClient per embed factory", () => {
    const { Dashboard } = createEmbed({
      App,
      scopeClass: "x",
      api: createApiClient(),
      themeKey: "k",
    });
    render(<Dashboard />);
    render(<Dashboard />);
    expect(screen.getAllByTestId("calls")).toHaveLength(2);
  });
});

describe("bootSpa", () => {
  it("themes <html>, strips the token, reads the base path and renders App", async () => {
    document.body.innerHTML = `<div id="root"></div>`;
    localStorage.setItem("xtandard-audit:theme", "dark");
    window.history.replaceState(null, "", "/audit/events?token=audpt_1&tenant=t");
    (window as unknown as Record<string, unknown>).__AUDIT_CONFIG__ = { basePath: "/audit/" };
    const api = createApiClient();
    let props: ShellAppProps | undefined;
    function App(p: ShellAppProps & { extra: string }) {
      props = p;
      return <p data-testid="app">{p.extra}</p>;
    }
    let booted!: ReturnType<typeof bootSpa>;
    await act(async () => {
      booted = bootSpa({
        App,
        configGlobal: "__AUDIT_CONFIG__",
        themeKey: "xtandard-audit:theme",
        tokenFromUrl: true,
        api,
        appProps: { extra: "hi" },
        strictMode: false,
      });
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(booted.token).toBe("audpt_1");
    expect(api.getApiToken()).toBe("audpt_1");
    expect(window.location.pathname + window.location.search).toBe("/audit/events?tenant=t");
    expect(screen.getByTestId("app").textContent).toBe("hi");
    expect(props!.base).toBe("/audit");
    act(() => booted.root.unmount());
  });

  it("needs an api for tokenFromUrl and a root element", () => {
    document.body.innerHTML = "";
    const App = () => null;
    expect(() =>
      bootSpa({ App, configGlobal: "__X__", themeKey: "k", tokenFromUrl: true }),
    ).toThrow(/needs the product's `api`/);
    expect(() => bootSpa({ App, configGlobal: "__X__", themeKey: "k" })).toThrow(
      /Root element not found/,
    );
  });
});
