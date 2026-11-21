/**
 * Bun adapter. Bun serves web-standard handlers natively, so the panel's
 * `fetch` is passed straight through; {@link toBunFetch} only binds it and
 * keeps the optional `server` argument out of the panel.
 *
 * ```ts
 * import { toBunFetch } from "@xtandard/kit/adapters/bun";
 *
 * Bun.serve({ port: 3000, fetch: toBunFetch(panel.fetch) });
 * ```
 *
 * @module
 */

import type { FetchHandler } from "./node.ts";

/** A `Bun.serve` `fetch` callback. */
export type BunFetch<Server = unknown> = (
  request: Request,
  server: Server,
) => Response | Promise<Response>;

/** Pass a fetch handler to `Bun.serve` (or `export default { fetch }`). */
export function toBunFetch<Server = unknown>(fetch: FetchHandler): BunFetch<Server> {
  return (request) => fetch(request);
}
