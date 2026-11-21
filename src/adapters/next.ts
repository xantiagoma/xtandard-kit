/**
 * Next.js App Router adapter: turn a panel (anything with a web `fetch`) into
 * the method exports of a catch-all route. Build the panel once at module
 * scope and set its `basePath` to the route's mount (e.g. `"/webhooks"` for
 * `app/webhooks/[[...path]]/route.ts`).
 *
 * ```ts
 * // app/webhooks/[[...path]]/route.ts
 * import { toNextHandler } from "@xtandard/kit/adapters/next";
 *
 * export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = toNextHandler(panel);
 * ```
 *
 * @module
 */

/** An App Router route handler. */
export type NextRouteHandler<Ctx = unknown> = (request: Request, context: Ctx) => Promise<Response>;

/** The method exports of a catch-all route. */
export interface NextRouteHandlers {
  GET: NextRouteHandler;
  HEAD: NextRouteHandler;
  POST: NextRouteHandler;
  PUT: NextRouteHandler;
  PATCH: NextRouteHandler;
  DELETE: NextRouteHandler;
  OPTIONS: NextRouteHandler;
}

/** Turn a panel into App Router method exports. */
export function toNextHandler(panel: {
  fetch(request: Request): Response | Promise<Response>;
}): NextRouteHandlers {
  const handle: NextRouteHandler = async (request) => panel.fetch(request);
  return {
    GET: handle,
    HEAD: handle,
    POST: handle,
    PUT: handle,
    PATCH: handle,
    DELETE: handle,
    OPTIONS: handle,
  };
}
