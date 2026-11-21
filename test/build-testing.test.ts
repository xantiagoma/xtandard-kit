/**
 * The reusable embed theme e2e cases register the five theme scenarios and drive a page through
 * the injected Playwright API (checked here with a scripted fake page).
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import { luminance, runEmbedThemeE2e, type PlaywrightApi } from "../src/build/testing.ts";

/** A fake page whose wrapper theme follows the last `open`/`evaluate`/click. */
function fakePage() {
  const state = {
    theme: "light",
    htmlTheme: null as string | null,
    followsOs: false,
  };
  const lum = () => (state.theme === "dark" ? 0.1 : 0.9);
  const page = {
    state,
    emulateMedia: vi.fn(async ({ colorScheme }: { colorScheme: string }) => {
      if (state.followsOs) state.theme = colorScheme;
    }),
    evaluate: vi.fn(async (fn: () => void) => {
      const s = fn.toString();
      state.theme = s.includes("remove") ? "light" : "dark";
    }),
    locator: (selector: string) => ({
      selector,
      first: () => ({
        evaluate: async () => (selector.endsWith(" h1") ? 1 - lum() : lum()),
      }),
      getAttribute: async () => state.htmlTheme,
    }),
    getByRole: (role: string, opts?: { name: string }) => ({
      role,
      name: opts?.name,
      click: async () => {
        if (opts?.name === "Dark theme") state.theme = "dark";
        if (opts?.name === "System theme") state.theme = "light";
      },
    }),
  };
  return page;
}

describe("runEmbedThemeE2e", () => {
  it("registers the five cases and runs them against the product's host", async () => {
    const tests: [string, (args: { page: never }) => Promise<void>][] = [];
    const test = Object.assign(
      (name: string, fn: (typeof tests)[number][1]) => tests.push([name, fn]),
      {
        describe: (_: string, fn: () => void) => fn(),
      },
    ) as PlaywrightApi["test"];
    let page = fakePage();
    const expectFn = (value: unknown) => ({
      toHaveAttribute: async (_: string, v: string) => expect(page.state.theme).toBe(v),
      toHaveCount: async () => {},
      toBeVisible: async () => {},
      toBeLessThan: (n: number) => expect(value).toBeLessThan(n),
      toBeGreaterThan: (n: number) => expect(value).toBeGreaterThan(n),
      toBeNull: () => expect(value).toBeNull(),
    });
    const opened: unknown[] = [];
    runEmbedThemeE2e(
      { test, expect: expectFn },
      {
        scope: "xtandard-flags",
        open: async (_page, host) => {
          opened.push(host);
          page.state.followsOs = host.theme === "inherit" && host.htmlClass === "";
          page.state.theme =
            host.theme === "dark" || (host.theme === "inherit" && host.htmlClass === "dark")
              ? "dark"
              : page.state.followsOs
                ? "dark" // the OS is dark in the fallback case
                : "light";
        },
        openDialog: async () => {},
      },
    );
    expect(tests.map(([n]) => n)).toHaveLength(5);
    for (const [, fn] of tests) {
      page = fakePage();
      await fn({ page: page as never });
    }
    expect(opened).toContainEqual({ htmlClass: "dark", theme: "inherit" });
    expect(opened).toContainEqual({ htmlClass: "", theme: "auto" });
  });

  it("luminance evaluates the computed colour in the page", async () => {
    const evaluate = vi.fn(async () => 0.5);
    const page = { locator: () => ({ first: () => ({ evaluate }) }) };
    expect(await luminance(page as never, ".x", "color")).toBe(0.5);
    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), "color");
  });
});
