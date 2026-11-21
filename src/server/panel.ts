/**
 * The panel handler skeleton every product wraps in its `createFetchHandler`:
 * one web-standard `(request) => Promise<Response>` that serves the
 * healthcheck, the product's JSON API, the OpenAPI document, the bundled SPA's
 * static assets and the SPA fallback, under any base path, with optional
 * CORS, plus a uniform `close()` that stops background tasks.
 *
 * Request flow:
 *
 * 1. `OPTIONS` with `cors` set → preflight `204`.
 * 2. `GET|HEAD /healthcheck` → `{ ok: true }`.
 * 3. The product's `api(request, path)`; a non-`null` response wins.
 * 4. `GET|HEAD /api/openapi.json` (and `/openapi.json`) when `openapi` is set.
 * 5. Any other method → `405` (`Allow: GET, HEAD`).
 * 6. A static asset from `uiDir`; a miss on an asset-looking path → `404`.
 * 7. The SPA `index.html` with the bootstrap injected, `cache-control: no-cache`.
 *
 * @module
 */

import { durationToMs, type Duration } from "../util/duration.ts";
import { normalizeBasePath, stripBasePath } from "./base-path.ts";
import { applyCorsHeaders, preflightResponse, type CorsOptions } from "./cors.ts";
import { json } from "./http.ts";
import { renderIndexHtml } from "./render-index-html.ts";
import { looksLikeAsset, serveStaticAsset } from "./static-assets.ts";

/** Background work owned by a panel (a dispatcher, a sweep timer…). */
export interface PanelTask {
  /** Called once when the panel is created. */
  start?(): void;
  /** Called once by `close()`. */
  stop(): void | Promise<void>;
}

/** Options for {@link createPanelHandler}. */
export interface PanelOptions {
  /** Mount prefix, e.g. `"/webhooks"`. Default `""` (root). */
  basePath?: string;
  /** UI title, in the page and the bootstrap. */
  title: string;
  /** Logo image URL shown in the navbar in place of the title wordmark. */
  logoUrl?: string;
  /** Reported to the SPA in the bootstrap. Default `false`. */
  readonly?: boolean;
  /**
   * The built SPA directory (see `resolveUiDir`). `undefined` serves no static
   * files and the fallback page (e.g. on Workers).
   */
  uiDir?: string | undefined;
  /** Answer CORS preflights and decorate every response. */
  cors?: CorsOptions;
  /**
   * The product's API router. Receives the base-path-stripped path; returns a
   * response, or `null` when the path is not an API route.
   */
  api?: (request: Request, path: string) => Promise<Response | null> | Response | null;
  /** Extra bootstrap fields injected into `index.html` (beside `title`, `basePath`, `readonly`, `logoUrl`). */
  bootstrap?: () => Record<string, unknown>;
  /** The global the SPA reads its bootstrap from, e.g. `"__WEBHOOKS_CONFIG__"`. */
  globalName: string;
  /** The OpenAPI document, served at `/api/openapi.json` and `/openapi.json` (public). */
  openapi?: () => Record<string, unknown>;
  /** Background tasks: started now, stopped by `close()`. */
  tasks?: readonly PanelTask[];
  /** Healthcheck path, or `false` to leave it to the product. Default `"/healthcheck"`. */
  healthcheck?: string | false;
}

/** What {@link createPanelHandler} returns. */
export interface PanelHandler {
  /** Web-standard request handler. */
  fetch(request: Request): Promise<Response>;
  /** The normalized base path. */
  readonly basePath: string;
  /** Stop every task (idempotent). */
  close(): Promise<void>;
}

const OPENAPI_PATHS = new Set(["/api/openapi.json", "/openapi.json"]);

/**
 * Build the panel handler.
 *
 * @example
 * ```ts
 * import { createPanelHandler, resolveUiDir } from "@xtandard/kit/server";
 *
 * const panel = createPanelHandler({
 *   basePath: options.basePath,
 *   title: options.title ?? "@xtandard/webhooks",
 *   globalName: "__WEBHOOKS_CONFIG__",
 *   uiDir: options.uiDir ?? resolveUiDir(import.meta.url),
 *   api: (request, path) => handleApiRequest(request, path, ctx),
 *   openapi: () => buildOpenApiDocument({ basePath, title }),
 *   tasks: [dispatcherTask],
 * });
 * Bun.serve({ fetch: panel.fetch });
 * ```
 */
export function createPanelHandler(options: PanelOptions): PanelHandler {
  const basePath = normalizeBasePath(options.basePath);
  const { cors, uiDir } = options;
  const healthcheck = options.healthcheck ?? "/healthcheck";
  const tasks = [...(options.tasks ?? [])];
  for (const task of tasks) task.start?.();
  let closing: Promise<void> | undefined;

  async function fetch(request: Request): Promise<Response> {
    // CORS preflight: answer OPTIONS directly so it works for any path,
    // independent of the host framework wrapping this handler.
    if (cors && request.method === "OPTIONS") return preflightResponse(request, cors);
    const response = await respond(request);
    return cors ? applyCorsHeaders(request, response, cors) : response;
  }

  async function respond(request: Request): Promise<Response> {
    const path = stripBasePath(new URL(request.url).pathname, basePath);
    const read = request.method === "GET" || request.method === "HEAD";

    if (read && healthcheck !== false && path === healthcheck) return json({ ok: true });

    const api = options.api ? await options.api(request, path) : null;
    if (api) return api;

    if (read && options.openapi && OPENAPI_PATHS.has(path)) return json(options.openapi());

    if (!read) {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    if (uiDir !== undefined) {
      const asset = await serveStaticAsset(uiDir, path);
      if (asset) return asset;
    }
    // A path that looks like a file but was not found → 404 (don't mask it with the SPA).
    if (path !== "/" && looksLikeAsset(path)) return new Response("Not Found", { status: 404 });

    const html = await renderIndexHtml(uiDir, {
      globalName: options.globalName,
      config: {
        title: options.title,
        basePath,
        readonly: options.readonly ?? false,
        ...(options.logoUrl !== undefined ? { logoUrl: options.logoUrl } : {}),
        ...options.bootstrap?.(),
      },
    });
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
    });
  }

  return {
    fetch,
    basePath,
    close() {
      closing ??= Promise.all(tasks.map(async (task) => task.stop())).then(() => undefined);
      return closing;
    },
  };
}

/** Options for {@link intervalTask}. */
export interface IntervalTaskOptions {
  /** Reports a rejected run. Default: `console.warn` with `[source]`. */
  onError?: (error: unknown) => void;
  /** Log prefix for the default `onError`. Default `"@xtandard/kit"`. */
  source?: string;
}

/**
 * A {@link PanelTask} that runs `run` every `every` (a `Duration`). The timer
 * is `unref()`ed so it never keeps the process alive; a run that rejects is
 * reported, never thrown. `every <= 0` makes a task that does nothing.
 *
 * @example
 * ```ts
 * tasks: [intervalTask("1m", () => engine.sweep(), { source: "@xtandard/entitlements" })]
 * ```
 */
export function intervalTask(
  every: Duration,
  run: () => unknown,
  options: IntervalTaskOptions = {},
): PanelTask {
  const ms = durationToMs(every);
  const onError =
    options.onError ??
    ((error: unknown) =>
      console.warn(`[${options.source ?? "@xtandard/kit"}] task failed:`, error));
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    start() {
      if (ms <= 0 || timer) return;
      timer = setInterval(() => {
        Promise.resolve()
          .then(run)
          .catch((error: unknown) => onError(error));
      }, ms);
      (timer as { unref?: () => void }).unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
