/**
 * Renders the SPA `index.html`: injects a `<base>` tag so relative asset URLs
 * resolve under any mount path, and a bootstrap `window.<globalName>` blob.
 * Falls back to a minimal built-in page when the UI bundle is absent (before
 * `bun run build:ui`, in headless tests, or on Workers without `node:fs`).
 *
 * Everything operator-controlled is escaped: the title (HTML), the `<base
 * href>` (attribute) and the bootstrap JSON (`<`, `>`, U+2028/U+2029, so it
 * can't close the `<script>` or break the line).
 *
 * @module
 */

/** Bootstrap config injected into the page. Products add their own fields. */
export interface BootstrapConfig {
  title: string;
  basePath: string;
  [key: string]: unknown;
}

/** Options for {@link renderIndexHtml}. */
export interface RenderIndexHtmlOptions {
  /**
   * The global the SPA reads its bootstrap from, e.g. `"__WEBHOOKS_CONFIG__"`.
   * Must be a JavaScript identifier.
   */
  globalName: string;
  /** The bootstrap config (`title` and `basePath` are required). */
  config: BootstrapConfig;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const escapeJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Build the `<base href>` value (always ends in `/`). */
function baseHref(basePath: string): string {
  return basePath === "" ? "/" : `${basePath}/`;
}

function headTags(options: RenderIndexHtmlOptions): string {
  return (
    `<base href="${escapeHtml(baseHref(options.config.basePath))}">` +
    `<script>window.${options.globalName}=${escapeJson(options.config)}</script>`
  );
}

function injectInto(html: string, options: RenderIndexHtmlOptions): string {
  const tags = headTags(options);
  if (html.includes("<head>")) return html.replace("<head>", () => `<head>${tags}`);
  return tags + html;
}

/** Minimal page served when no built UI is present. */
function fallbackHtml(options: RenderIndexHtmlOptions): string {
  const title = escapeHtml(String(options.config.title));
  const code = "background:#1a1a1a;padding:2px 6px;border-radius:4px";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${headTags(
    options,
  )}<title>${title}</title></head><body style="font-family:system-ui;margin:0;padding:3rem;background:#0a0a0a;color:#e5e5e5"><h1 style="margin:0 0 .5rem">${title}</h1><p style="color:#a3a3a3">The admin UI bundle is not built. Run <code style="${code}">bun run build:ui</code>. The JSON API at <code style="${code}">api/</code> is fully available (<a style="color:#2dd4bf" href="api/openapi.json">OpenAPI</a>).</p></body></html>`;
}

/**
 * Read, inject into, and return the SPA index HTML from `uiDir`, or the
 * fallback page when `uiDir` is `undefined` or has no `index.html`.
 *
 * @example
 * ```ts
 * const html = await renderIndexHtml(uiDir, {
 *   globalName: "__WEBHOOKS_CONFIG__",
 *   config: { title, basePath, readonly },
 * });
 * ```
 */
export async function renderIndexHtml(
  uiDir: string | undefined,
  options: RenderIndexHtmlOptions,
): Promise<string> {
  if (!IDENTIFIER.test(options.globalName)) {
    throw new TypeError(
      `renderIndexHtml: globalName must be an identifier, got "${options.globalName}"`,
    );
  }
  if (uiDir === undefined) return fallbackHtml(options);
  try {
    const [{ readFile }, { join }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const html = await readFile(join(uiDir, "index.html"), "utf8");
    return injectInto(html, options);
  } catch {
    return fallbackHtml(options);
  }
}
