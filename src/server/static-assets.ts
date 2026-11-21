/**
 * Serves the bundled SPA's static assets from the UI output directory. Maps file
 * extensions to content types and guards against path traversal.
 *
 * `node:fs` / `node:path` are imported lazily, only when an asset is actually
 * served, so a runtime without them (Cloudflare Workers without
 * `nodejs_compat`) can still import the panel and serve the API — it just
 * passes no `uiDir`.
 *
 * @module
 */

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function contentType(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** True if the path has a file extension (so a miss should 404 rather than fall through to the SPA). */
export function looksLikeAsset(path: string): boolean {
  const last = path.split("/").pop() ?? "";
  return last.includes(".");
}

/**
 * Try to serve `path` (base-path-stripped, leading `/`) as a static file from
 * `uiDir`. Returns a `Response`, or `null` if the file does not exist or the
 * path escapes `uiDir`. Files under `assets/` (content-hashed by the bundler)
 * are cached for a year; everything else is `no-cache`.
 */
export async function serveStaticAsset(uiDir: string, path: string): Promise<Response | null> {
  const [{ readFile }, { join, normalize, resolve, sep }] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  // Resolve within uiDir and refuse anything that escapes it (including sibling
  // directories that merely share the prefix, e.g. `ui-private`).
  const rel = normalize(path).replace(/^(\.\.(\/|\\|$))+/, "");
  const root = resolve(uiDir);
  const full = resolve(join(root, rel));
  if (full !== root && !full.startsWith(root + sep)) return null;
  try {
    const data = await readFile(full);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "content-type": contentType(full),
        "cache-control": rel.includes("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      },
    });
  } catch {
    return null;
  }
}

/**
 * Locate a product's built SPA. Pass the product module's `import.meta.url`:
 * compiled (the npm-consumer case) the bundle is the sibling `./ui` of the
 * module's `dist/` chunk; run from TypeScript source (examples, `file:`
 * links) it is `<repo>/dist/ui`. Falls back to the compiled-layout path so the
 * "build the UI" hint still fires when nothing is built yet.
 *
 * Extra `candidates` (relative to `moduleUrl`) are tried first. Returns
 * `undefined` when the module URL is not a `file:` URL or the runtime has no
 * `node:fs` (Workers): the panel then serves the API and a fallback page.
 *
 * @example
 * ```ts
 * const uiDir = options.uiDir ?? resolveUiDir(import.meta.url);
 * ```
 */
export function resolveUiDir(
  moduleUrl: string | URL,
  candidates: readonly string[] = [],
): string | undefined {
  const fs = getBuiltin<{ existsSync(path: string): boolean }>("node:fs");
  const url = getBuiltin<{ fileURLToPath(url: URL): string }>("node:url");
  if (!fs || !url) return undefined;
  try {
    const paths = [...candidates, "./ui", "../../dist/ui"].map((c) =>
      url.fileURLToPath(new URL(c, moduleUrl)),
    );
    return paths.find((p) => fs.existsSync(p)) ?? paths[candidates.length];
  } catch {
    return undefined;
  }
}

/** A Node built-in, synchronously, when the runtime has it (Node ≥ 20.16, Bun, Deno). */
function getBuiltin<T>(name: string): T | undefined {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  return proc?.getBuiltinModule?.(name) as T | undefined;
}
