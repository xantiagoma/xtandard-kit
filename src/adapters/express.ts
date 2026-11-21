/**
 * Express adapter: a middleware factory over the shared Node bridge
 * (`@xtandard/kit/adapters/node`). No `express` import at runtime — only its
 * types.
 *
 * Mount it before or after body-parser middleware: a body already parsed by
 * `express.json()` / `express.urlencoded()` / `express.text()` /
 * `express.raw()` is re-serialised. Multiple `Set-Cookie` headers are kept and
 * response bodies are streamed with backpressure.
 *
 * ```ts
 * import express from "express";
 * import { toExpressMiddleware } from "@xtandard/kit/adapters/express";
 *
 * const app = express();
 * app.use("/webhooks", toExpressMiddleware(panel.fetch));
 * ```
 *
 * @module
 */

import type { NextFunction, Request as ExRequest, Response as ExResponse } from "express";
import {
  toWebRequest,
  writeWebResponse,
  type FetchHandler,
  type NodeRequest,
  type ToWebRequestOptions,
} from "./node.ts";

/** An Express middleware. */
export type ExpressMiddleware = (req: ExRequest, res: ExResponse, next: NextFunction) => void;

/** Options for {@link toExpressMiddleware}. */
export interface ExpressMiddlewareOptions extends ToWebRequestOptions {
  /**
   * Call `next()` (instead of answering) when the handler returns this status,
   * e.g. `404`, so routes mounted after the panel still run. Default: never.
   */
  fallthroughStatus?: number;
}

/**
 * Serve a fetch handler from Express. Errors go to `next(error)`.
 *
 * Use with `app.use(path, middleware)`: the panel sees `req.originalUrl`, so
 * set its `basePath` to the mount path.
 */
export function toExpressMiddleware(
  fetch: FetchHandler,
  options: ExpressMiddlewareOptions = {},
): ExpressMiddleware {
  return (req, res, next) => {
    void (async () => {
      const request = await toWebRequest(req as unknown as NodeRequest, options);
      const response = await fetch(request);
      if (
        options.fallthroughStatus !== undefined &&
        response.status === options.fallthroughStatus
      ) {
        await response.body?.cancel().catch(() => undefined);
        next();
        return;
      }
      await writeWebResponse(res, response, request);
    })().catch(next);
  };
}
