/**
 * Scoping for a product's React-embed stylesheet.
 *
 * The embed build emits `dist/react.css` as a full, unscoped Tailwind build: global preflight
 * resets (`*`, `button`, `h1`, `a`, …) plus generic utilities (`.flex`, `.border`, …). A host app
 * importing it (`@xtandard/<product>/react/styles.css`) would get its whole page restyled.
 *
 * {@link scopeCss} prefixes every rule with the embed's wrapper class. The design-token
 * `:root`/`html` blocks (including `:root[data-theme="dark"]` and `:root.dark`) and the `body`
 * surface rule are re-homed onto the wrapper itself, and keyframe steps are left alone. The
 * standalone SPA build (`dist/ui`) is not processed: it legitimately owns the whole document.
 *
 * Needs the optional peers `postcss` and `postcss-prefix-selector`.
 *
 * @module
 */

import { readFile, writeFile } from "node:fs/promises";
import { importPeer } from "../internal/peer.ts";

const SUBPATH = "@xtandard/kit/build";

/** `".xtandard-flags"` → `".xtandard-flags"`; a bare `"xtandard-flags"` gets its dot. */
export function normalizeScope(scope: string): string {
  const s = scope.trim();
  const withDot = s.startsWith(".") ? s : `.${s}`;
  if (!/^\.[A-Za-z_-][\w-]*$/.test(withDot)) {
    throw new Error(`scope must be a single class name such as ".xtandard-flags", got "${scope}"`);
  }
  return withDot;
}

/**
 * Prefix every rule in `css` with `scope` (a class, e.g. `".xtandard-flags"`), re-homing
 * `:root`/`html`/`:host`/`body` onto the wrapper and leaving keyframe steps alone. Pure.
 */
export async function scopeCss(css: string, scope: string): Promise<string> {
  const prefix = normalizeScope(scope);
  const [{ default: postcss }, { default: prefixSelector }] = await Promise.all([
    importPeer("postcss", SUBPATH, () => import("postcss")),
    importPeer("postcss-prefix-selector", SUBPATH, () => import("postcss-prefix-selector")),
  ]);
  const result = await postcss([
    prefixSelector({
      prefix,
      transform(prefix: string, selector: string, prefixedSelector: string): string {
        const s = selector.trim();
        // Keyframe steps (`from`, `to`, `47%`, `0%,50%`) are not element selectors.
        if (/^(\d+(\.\d+)?%|from|to)$/.test(s)) return selector;
        // Design tokens live on :root/html — re-home them onto the wrapper so the embed's own
        // scope carries them (the host <html> is untouched). `body` carries the page surface
        // (background, text colour, font): the wrapper is the embed's "page", so it gets them too,
        // otherwise its text inherits the host's colour over the dashboard's own surfaces.
        if (/^(:root|html|:host|body)$/.test(s)) return prefix;
        // Compound root selectors — the dark tokens on `:root[data-theme="dark"]`, `:root.dark`,
        // `:root:not(…)` — become the wrapper with the same qualifier
        // (`.xtandard-flags[data-theme="dark"]`), matching the `data-theme` the embed sets on its
        // own wrapper.
        const compound = /^(?::root|html)([[:.].*)$/.exec(s);
        if (compound) return `${prefix}${compound[1]}`;
        return prefixedSelector;
      },
    }),
  ]).process(css, { from: undefined });
  return result.css;
}

/**
 * Rules that would restyle the host document if they escaped the scope: preflight resets, the
 * universal custom-property rule, and token blocks left on `:root`/`html`/`body`. Returns the
 * offending rule fragments (empty when fully scoped).
 */
export function findUnscopedLeaks(css: string, scope: string): string[] {
  const prefix = normalizeScope(scope);
  // A fragment is scoped when the class appears as a whole class token (not `.x-flags-other`).
  const scoped = new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?![\\w-])`);
  return css
    .split("}")
    .filter((rule) =>
      /text-size-adjust|^\s*\*[,{]|^\s*(button|a|h1|table)[,{]|^\s*(:root|html|body)[[,{:.\s]/.test(
        rule,
      ),
    )
    .filter((rule) => !scoped.test(rule));
}

/** What {@link scopeCssFile} did. */
export interface ScopeCssFileResult {
  /** The file that was rewritten. */
  path: string;
  /** Unscoped fragments left after scoping (the command fails when non-empty). */
  leaks: string[];
}

/**
 * Scope a stylesheet on disk in place (`xtandard-kit scope-embed-css --scope … --css …`), then
 * check it for leaks.
 */
export async function scopeCssFile(path: string, scope: string): Promise<ScopeCssFileResult> {
  const scoped = await scopeCss(await readFile(path, "utf8"), scope);
  await writeFile(path, scoped);
  return { path, leaks: findUnscopedLeaks(scoped, scope) };
}
