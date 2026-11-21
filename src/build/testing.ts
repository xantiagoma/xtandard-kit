/**
 * Reusable test suites for a product's UI build, with the test API injected (like the storage
 * conformance suite), so they run under vitest, `bun:test` or Playwright without the kit importing
 * a runner:
 *
 * - {@link runEmbedCssSuite}: the embed-CSS scoping regression cases, for the product's scope (and
 *   its built `dist/react.css`, when given);
 * - {@link runEmbedThemeE2e}: the embed theme e2e cases (class host, live switch, OS fallback, own
 *   switcher themes only the wrapper, forced theme), given a way to open the product's host page.
 *
 * @module
 */

import type { Page } from "@playwright/test";
import { findUnscopedLeaks, normalizeScope, scopeCss } from "./scope-css.ts";

/** The `describe`/`it`/`expect` subset the suites use (vitest, `bun:test` and Playwright fit). */
export interface SuiteApi {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => Promise<void> | void) => void;
  // oxlint-disable-next-line typescript/no-explicit-any -- each runner types `expect` its own way
  expect: (value: unknown) => any;
}

/** A representative slice of the real Tailwind v4 embed output. */
export const EMBED_CSS_SAMPLE: string = [
  "/*! tailwindcss v4 */",
  "@layer properties{@supports (x:y){*,:before,:after,::backdrop{--tw-translate-x:0}}}",
  "html,:host{-webkit-text-size-adjust:100%;line-height:1.5}",
  "*,:before,:after{box-sizing:border-box;border:0 solid}",
  "button,input{font:inherit}",
  "a{color:inherit}",
  ":root{--background:#fff;--foreground:#0a0a0a}",
  ':root[data-theme="dark"]{--background:#0a0a0a;--foreground:#fafafa}',
  ":root.dark{--ring:#333}",
  "body{background-color:var(--background);color:var(--foreground)}",
  ".flex{display:flex}",
  ".border{border-width:1px}",
  ".px-4{padding-inline:1rem}",
  "@keyframes spin{from{transform:rotate(0)}50%{opacity:.5}to{transform:rotate(360deg)}}",
].join("");

/** Options for {@link runEmbedCssSuite}. */
export interface EmbedCssSuiteOptions {
  /** The embed's wrapper class (`".xtandard-flags"`). */
  scope: string;
  /** Read the built, scoped stylesheet (e.g. `dist/react.css`) to check it for leaks too. */
  readBuiltCss?: () => Promise<string | undefined> | string | undefined;
}

/** The embed-CSS scoping regression cases, for one product's scope. */
export function runEmbedCssSuite(t: SuiteApi, options: EmbedCssSuiteOptions): void {
  const scope = normalizeScope(options.scope);
  const { describe, it, expect } = t;
  describe(`embed CSS scoping (${scope})`, () => {
    it("prefixes preflight resets and utilities with the wrapper scope", async () => {
      const out = await scopeCss(EMBED_CSS_SAMPLE, scope);
      expect(out).toContain(`${scope} .flex{`);
      expect(out).toContain(`${scope} .border{`);
      expect(/}\.flex\{/.test(out)).toBe(false);
      expect(out).toContain(`${scope} *`);
      expect(out).toContain(`${scope} button`);
    });

    it("re-homes :root / html design tokens onto the wrapper itself", async () => {
      const out = await scopeCss(EMBED_CSS_SAMPLE, scope);
      expect(out).toContain(`${scope}{--background:#fff`);
      expect(/(^|})[:]root[{.[]/.test(out)).toBe(false);
      expect(/(^|})html\{/.test(out)).toBe(false);
    });

    it("re-homes the dark tokens onto the wrapper's own data-theme (and :root.dark)", async () => {
      const out = await scopeCss(EMBED_CSS_SAMPLE, scope);
      expect(out).toContain(`${scope}[data-theme="dark"]{--background:#0a0a0a`);
      expect(out).not.toContain(`${scope} :root[data-theme="dark"]`);
      expect(out).toContain(`${scope}.dark{--ring:#333}`);
    });

    it("gives the wrapper the page surface from body", async () => {
      const out = await scopeCss(EMBED_CSS_SAMPLE, scope);
      expect(out).toContain(`${scope}{background-color:var(--background);color:var(--foreground)}`);
      expect(out).not.toContain(`${scope} body`);
    });

    it("leaves @keyframes steps untouched", async () => {
      const out = await scopeCss(EMBED_CSS_SAMPLE, scope);
      expect(out).toContain("@keyframes spin{from{");
      expect(out).toContain("50%{opacity:.5}");
      expect(out).not.toContain(`${scope} from`);
    });

    it("passes the leak guardrail after scoping, and catches an unscoped build", async () => {
      expect(findUnscopedLeaks(await scopeCss(EMBED_CSS_SAMPLE, scope), scope)).toEqual([]);
      expect(findUnscopedLeaks(EMBED_CSS_SAMPLE, scope).length > 0).toBe(true);
    });

    if (options.readBuiltCss) {
      const read = options.readBuiltCss;
      it("the built embed stylesheet has no unscoped rules", async () => {
        const css = await read();
        if (css === undefined) return; // not built in this run
        expect(findUnscopedLeaks(css, scope)).toEqual([]);
      });
    }
  });
}

/** Relative luminance (0 = black, 1 = white) of an element's computed colour property. */
export function luminance(
  page: Page,
  selector: string,
  prop: "color" | "backgroundColor",
): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate((el, p) => {
      // Computed colours may be oklch(); paint to a canvas to get sRGB bytes.
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.fillStyle = getComputedStyle(el)[p as "color"];
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }, prop);
}

/** What the host page should look like for one theme case. */
export interface EmbedHostOptions {
  /** Class on the host `<html>` (`"dark"`, or `""`). */
  htmlClass: string;
  /** The embed's `theme` prop. */
  theme: "auto" | "inherit" | "light" | "dark";
}

/** The injected Playwright API for {@link runEmbedThemeE2e}. */
export interface PlaywrightApi {
  test: {
    describe: (name: string, fn: () => void) => void;
    (name: string, fn: (args: { page: Page }) => Promise<void>): void;
  };
  // oxlint-disable-next-line typescript/no-explicit-any -- Playwright's expect is overloaded
  expect: any;
}

/** Options for {@link runEmbedThemeE2e}. */
export interface EmbedThemeE2eOptions {
  /** The embed's wrapper class (`".xtandard-flags"`). */
  scope: string;
  /** Open the product's host page with the embed mounted, and wait until it rendered. */
  open: (page: Page, host: EmbedHostOptions) => Promise<void>;
  /** A text element inside the embed whose colour follows the theme; `"h1"` by default. */
  textSelector?: string;
  /** Open a dialog inside the embed (to check portals take the theme), if the product has one. */
  openDialog?: (page: Page) => Promise<void>;
}

/** The embed theme e2e cases, for one product. */
export function runEmbedThemeE2e(pw: PlaywrightApi, options: EmbedThemeE2eOptions): void {
  const { test, expect } = pw;
  const wrapper = normalizeScope(options.scope);
  const text = `${wrapper} ${options.textSelector ?? "h1"}`;

  const expectDark = async (page: Page) => {
    await expect(page.locator(wrapper)).toHaveAttribute("data-theme", "dark");
    expect(await luminance(page, wrapper, "backgroundColor")).toBeLessThan(0.25);
    expect(await luminance(page, text, "color")).toBeGreaterThan(0.75);
  };
  const expectLight = async (page: Page) => {
    await expect(page.locator(wrapper)).toHaveAttribute("data-theme", "light");
    expect(await luminance(page, wrapper, "backgroundColor")).toBeGreaterThan(0.75);
    expect(await luminance(page, text, "color")).toBeLessThan(0.25);
  };

  test.describe("embed theme", () => {
    test('theme="inherit" follows a class-based dark host even when the OS is light', async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await options.open(page, { htmlClass: "dark", theme: "inherit" });
      await expectDark(page);
      // The host owns the theme: no in-panel switcher, and the host <html> is untouched.
      await expect(page.getByRole("group", { name: "Theme" })).toHaveCount(0);
      expect(await page.locator("html").getAttribute("data-theme")).toBeNull();
      if (options.openDialog) {
        await options.openDialog(page);
        await expect(page.getByRole("dialog")).toBeVisible();
        expect(await luminance(page, '[role="dialog"]', "backgroundColor")).toBeLessThan(0.25);
      }
    });

    test('theme="inherit" switches live when the host toggles its class', async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await options.open(page, { htmlClass: "dark", theme: "inherit" });
      await expectDark(page);
      await page.evaluate(() => document.documentElement.classList.remove("dark"));
      await expectLight(page);
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await expectDark(page);
    });

    test('theme="inherit" falls back to prefers-color-scheme when the host sets nothing', async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await options.open(page, { htmlClass: "", theme: "inherit" });
      await expectDark(page);
      await page.emulateMedia({ colorScheme: "light" });
      await expectLight(page);
    });

    test('theme="auto" keeps its own switcher and themes only its wrapper', async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await options.open(page, { htmlClass: "", theme: "auto" });
      await expectLight(page);
      await page.getByRole("button", { name: "Dark theme" }).click();
      await expectDark(page);
      expect(await page.locator("html").getAttribute("data-theme")).toBeNull();
      // Reset the persisted preference for other tests sharing this origin.
      await page.getByRole("button", { name: "System theme" }).click();
    });

    test('theme="dark" is fixed regardless of host and OS', async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await options.open(page, { htmlClass: "", theme: "dark" });
      await expectDark(page);
      await expect(page.getByRole("group", { name: "Theme" })).toHaveCount(0);
    });
  });
}
