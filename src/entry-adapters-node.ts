/**
 * `@xtandard/kit/adapters/node` — the Fetch ↔ Node bridge shared by Express
 * and the CLI: appended multi-value headers, re-serialised pre-parsed bodies,
 * every `Set-Cookie` kept, response bodies streamed with backpressure and
 * cancelled on disconnect.
 *
 * @module
 */

export {
  headersFrom,
  requestUrl,
  toNodeHandler,
  toWebRequest,
  writeWebResponse,
  type FetchHandler,
  type NodeHandlerOptions,
  type NodeRequest,
  type ToWebRequestOptions,
} from "./adapters/node.ts";
