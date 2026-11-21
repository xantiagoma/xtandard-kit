import { expect, test, type Page } from "@playwright/test";
import { runEmbedThemeE2e } from "../src/build/testing.ts";

const WRAPPER = ".xtandard-kit-e2e";

async function openEmbed(page: Page, { htmlClass = "", theme = "inherit" } = {}): Promise<void> {
  await page.goto(`/embed.html?theme=${theme}&htmlClass=${htmlClass}`);
  await expect(page.locator(`${WRAPPER} h1`)).toHaveText("Overview");
}

// The shared theme cases, as every product runs them.
runEmbedThemeE2e(
  { test, expect },
  {
    scope: WRAPPER,
    open: (page, host) => openEmbed(page, host),
    openDialog: (page) => page.getByRole("button", { name: "Open dialog" }).click(),
  },
);

test.describe("embed scoping", () => {
  test("the scoped stylesheet leaves the host page alone", async ({ page }) => {
    await openEmbed(page, { theme: "light" });
    // Tailwind's preflight would make the host button transparent and borderless.
    const host = page.locator("#host-button");
    const style = await host.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, border: s.borderTopWidth };
    });
    expect(style.bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.border).not.toBe("0px");
    // The host heading keeps the browser's default size; the embed's h1 is styled.
    expect(
      await page.locator("#host-header h2").evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe("24px");
    // The tokens live on the wrapper, not on the host document.
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--background"),
      ),
    ).toBe("");
  });

  test("dialogs portal into the wrapper", async ({ page }) => {
    await openEmbed(page, { theme: "dark" });
    await page.getByRole("button", { name: "Open dialog" }).click();
    await expect(page.locator(`${WRAPPER} [role="dialog"]`)).toBeVisible();
  });
});

test.describe("embed memory routing", () => {
  test("tabs navigate in memory and keep the query string", async ({ page }) => {
    await openEmbed(page, { theme: "light" });
    const url = page.url();
    await page.getByRole("button", { name: "Use tenant acme" }).click();
    await expect(page.getByTestId("where")).toHaveText("/?tenant=acme");
    // The sticky tenant survives tab navigation: only possible when the memory router's
    // searchHook is wired (it used to fall back to the host's location.search).
    await page.getByRole("button", { name: "Events" }).click();
    await expect(page.locator(`${WRAPPER} h1`)).toHaveText("Events");
    await expect(page.getByTestId("where")).toHaveText("/events?tenant=acme");
    await page.getByTestId("shell-brand").click();
    await expect(page.locator(`${WRAPPER} h1`)).toHaveText("Overview");
    await expect(page.getByTestId("where")).toHaveText("/?tenant=acme");
    expect(page.url()).toBe(url);
  });
});

test.describe("standalone SPA", () => {
  test("bootSpa themes <html>, the toggle switches it, and the token leaves the URL", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/?token=kit_tok&tenant=acme#tab=1");
    await expect(page.locator("h1")).toHaveText("Overview");
    // The token is attached (the server answers portal) and stripped from the address bar.
    await expect(page.getByText("Portal", { exact: true })).toBeVisible();
    expect(new URL(page.url()).search).toBe("?tenant=acme");
    expect(new URL(page.url()).hash).toBe("#tab=1");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "System theme" }).click();
  });

  test("tabs keep the sticky tenant param in browser routing", async ({ page }) => {
    await page.goto("/?tenant=acme");
    await page.getByRole("button", { name: "Events" }).click();
    await expect(page.locator("h1")).toHaveText("Events");
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/events?tenant=acme");
  });
});
