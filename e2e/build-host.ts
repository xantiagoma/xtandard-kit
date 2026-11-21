/**
 * Builds the e2e test host (e2e/host) with the kit's own `defineUiConfig`, then scopes the embed
 * page's stylesheet with the kit's `scopeCssFile`, exactly like a product's `build:react`.
 *
 * Output: node_modules/.cache/kit-e2e-host (spa.html, embed.html, assets/).
 */
import { build } from "vite";
import { defineUiConfig } from "../src/build/config.ts";
import { scopeCssFile } from "../src/build/scope-css.ts";

export const HOST_OUT = new URL("../node_modules/.cache/kit-e2e-host/", import.meta.url);

const ui = await defineUiConfig({ root: "e2e/host", outDir: "node_modules/.cache/kit-e2e-host" });
await build({
  ...ui,
  configFile: false,
  logLevel: "warn",
  build: {
    ...ui.build,
    rollupOptions: {
      input: { spa: "e2e/host/spa.html", embed: "e2e/host/embed.html" },
      output: { assetFileNames: "assets/[name][extname]" },
    },
  },
});

const { leaks } = await scopeCssFile(
  new URL("assets/embed.css", HOST_OUT).pathname,
  "xtandard-kit-e2e",
);
if (leaks.length) throw new Error(`embed.css leaks:\n${leaks.slice(0, 3).join("\n")}`);
console.log("e2e host built");
