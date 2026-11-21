/**
 * The one Fetch ↔ Node bridge, shared by the Express adapter and the CLI's
 * Node server: it turns a `node:http` request into a web `Request` and writes
 * a web `Response` back.
 *
 * - Multi-value request headers are appended one by one (not joined).
 * - A body already parsed by middleware (`express.json()`, `express.text()`,
 *   `express.raw()`, `express.urlencoded()`) is re-serialised; otherwise the
 *   stream is read (or, with `lazyBody`, read only when the handler pulls it).
 * - Every `Set-Cookie` header is kept (`getSetCookie`), not collapsed into one.
 * - Response bodies are **streamed** with backpressure (`drain`), and the
 *   reader is cancelled when the client goes away — SSE and exports work and
 *   don't buffer in memory.
 *
 * No runtime import of `node:http`: only its types.
 *
 * @module
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** A web-standard fetch handler. */
export type FetchHandler = (request: Request) => Response | Promise<Response>;

/** A Node request, possibly decorated by Express (`originalUrl`, `protocol`, `body`). */
export type NodeRequest = IncomingMessage & {
  originalUrl?: string;
  protocol?: string;
  body?: unknown;
};

/** Options for {@link toWebRequest}. */
export interface ToWebRequestOptions {
  /**
   * Stream the request body to the handler only when it reads it, instead of
   * buffering it first. Lets later middleware see an untouched stream when the
   * handler ignores the body. Default `false`.
   */
  lazyBody?: boolean;
  /** Override the origin (`https://example.com`); default: protocol + `Host` header. */
  origin?: string;
}

/** Copy Node headers into `Headers`, appending each value of a multi-value header. */
export function headersFrom(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }
  return headers;
}

/** The absolute URL of a Node request; `originalUrl` keeps an Express mount prefix. */
export function requestUrl(req: NodeRequest, origin?: string): string {
  const path = req.originalUrl ?? req.url ?? "/";
  if (origin) return `${origin.replace(/\/$/, "")}${path}`;
  const encrypted = (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true;
  const protocol = req.protocol || (encrypted ? "https" : "http");
  return `${protocol}://${req.headers.host ?? "localhost"}${path}`;
}

/** A body already consumed and parsed by middleware, re-serialised; `undefined` when there is none. */
function parsedBody(req: NodeRequest): Uint8Array | undefined {
  const body = req.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === "object" && Object.keys(body).length === 0 && !hasContent(req)) {
    return undefined; // express.json() sets `{}` when there was no body at all
  }
  const type = String(req.headers["content-type"] ?? "");
  const text = type.includes("application/x-www-form-urlencoded")
    ? new URLSearchParams(body as Record<string, string>).toString()
    : JSON.stringify(body);
  return new TextEncoder().encode(text);
}

const hasContent = (req: IncomingMessage): boolean =>
  Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;

async function readAll(req: IncomingMessage): Promise<Uint8Array | undefined> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    chunks.push(bytes);
    size += bytes.byteLength;
  }
  if (size === 0) return undefined;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** A body stream that only pulls from `req` when someone reads it. */
function lazyStream(req: IncomingMessage): ReadableStream<Uint8Array> {
  let iterator: AsyncIterator<Uint8Array | string> | undefined;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        iterator ??= (req as AsyncIterable<Uint8Array | string>)[Symbol.asyncIterator]();
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else
          controller.enqueue(
            typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value),
          );
      },
      async cancel() {
        await iterator?.return?.();
      },
    },
    { highWaterMark: 0 },
  );
}

/** Convert a Node (or Express) request into a web `Request`. */
export async function toWebRequest(
  req: NodeRequest,
  options: ToWebRequestOptions = {},
): Promise<Request> {
  const method = (req.method ?? "GET").toUpperCase();
  const init: RequestInit & { duplex?: "half" } = { method, headers: headersFrom(req) };
  if (method !== "GET" && method !== "HEAD") {
    if (req.readableEnded || req.body !== undefined) {
      const body = parsedBody(req);
      if (body) init.body = body as BodyInit;
    } else if (options.lazyBody) {
      init.body = lazyStream(req);
      init.duplex = "half";
    } else {
      const body = await readAll(req);
      if (body) init.body = body as BodyInit;
    }
  }
  if (init.body !== undefined && !(init.body instanceof ReadableStream)) {
    // The body was re-serialised: the original length no longer applies.
    (init.headers as Headers).delete("content-length");
    (init.headers as Headers).delete("transfer-encoding");
  }
  return new Request(requestUrl(req, options.origin), init);
}

/**
 * Write a web `Response` to a Node `ServerResponse`, streaming the body with
 * backpressure. Stops reading (and cancels the body) when the client
 * disconnects.
 */
export async function writeWebResponse(
  res: ServerResponse,
  response: Response,
  request?: { method?: string },
): Promise<void> {
  res.statusCode = response.status;
  if (response.statusText) res.statusMessage = response.statusText;
  const cookies = response.headers.getSetCookie?.() ?? [];
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") res.setHeader(key, value);
  });
  if (cookies.length) res.setHeader("set-cookie", cookies);
  else if (response.headers.has("set-cookie")) {
    res.setHeader("set-cookie", response.headers.get("set-cookie") as string);
  }

  if (!response.body || (request?.method ?? "").toUpperCase() === "HEAD") {
    await response.body?.cancel().catch(() => undefined);
    res.end();
    return;
  }
  const reader = response.body.getReader();
  let closed = false;
  const onClose = () => {
    closed = true;
    void reader.cancel().catch(() => undefined);
  };
  res.once("close", onClose);
  try {
    for (;;) {
      if (closed || res.destroyed) break;
      const { value, done } = await reader.read();
      if (done) break;
      if (!res.write(value)) {
        await new Promise<void>((resolve) => {
          const done = () => {
            res.off("drain", done);
            res.off("close", done);
            resolve();
          };
          res.once("drain", done);
          res.once("close", done);
        });
      }
    }
    if (!closed && !res.destroyed) res.end();
  } finally {
    res.off("close", onClose);
  }
}

/** Options for {@link toNodeHandler}. */
export interface NodeHandlerOptions extends ToWebRequestOptions {
  /**
   * Called when the handler throws. Default: a plain `500` (when headers have
   * not been sent yet).
   */
  onError?: (error: unknown, req: IncomingMessage, res: ServerResponse) => void;
}

/**
 * Wrap a fetch handler as a `node:http` request listener.
 *
 * @example
 * ```ts
 * import { createServer } from "node:http";
 * createServer(toNodeHandler(panel.fetch)).listen(3000);
 * ```
 */
export function toNodeHandler(
  fetch: FetchHandler,
  options: NodeHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      const request = await toWebRequest(req, options);
      await writeWebResponse(res, await fetch(request), request);
    })().catch((error: unknown) => {
      if (options.onError) return options.onError(error, req, res);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain; charset=utf-8");
      }
      res.end(`Internal error: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
}
