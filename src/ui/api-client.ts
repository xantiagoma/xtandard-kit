/**
 * The admin SPA's HTTP client core for the panel API. Each product creates one client
 * ({@link createApiClient}) and builds its endpoint functions on `req`/`send`. The client holds the
 * base URL, credentials mode, fetch implementation and portal token; the bundled SPA or the React
 * embed sets them once (one embed per product per page).
 *
 * @module
 */

/** The subset of `fetch` the client uses (the global `fetch` satisfies it). */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Options for {@link ApiClient.setApiBase}. */
export interface ApiClientOptions {
  /** `credentials` mode for requests. Use `"include"` for cross-origin cookie auth. */
  credentials?: RequestCredentials;
  /** Custom fetch implementation (bearer tokens, extra headers, instrumentation). */
  fetch?: FetchLike;
}

/** The JSON error body the panel API returns, with the HTTP status always filled in. */
export interface ApiErrorBody {
  /** Human-readable message. */
  error: string;
  /** The HTTP status of the response (forced from the response, whatever the body says). */
  status: number;
  /** Per-field validation issues. */
  errors?: { path: string; message: string }[];
  /** A machine-readable code, when the API sends one. */
  code?: string;
  [key: string]: unknown;
}

/** Thrown by the client for non-2xx responses. Products subclass it (`WebhooksApiError`…). */
export class ApiError extends Error {
  /** The HTTP status. */
  readonly status: number;
  /** The parsed error body. */
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** A constructor for the error the client throws (an {@link ApiError} subclass, or compatible). */
export type ApiErrorConstructor = new (status: number, body: ApiErrorBody) => Error;

/** Options for {@link createApiClient}. */
export interface CreateApiClientOptions {
  /** The error class to throw for non-2xx responses (the product's `…ApiError`). */
  errorClass?: ApiErrorConstructor;
  /** Initial base URL; `""` (relative to the page) by default. */
  base?: string;
  /** Initial `credentials` mode; `"same-origin"` by default. */
  credentials?: RequestCredentials;
  /** Initial fetch implementation; the global `fetch` by default (read at call time). */
  fetch?: FetchLike;
}

/** A query-string value accepted by {@link toQuery}. */
export type QueryValue = string | number | boolean | null | undefined | readonly string[];

/** One product's API client. */
export interface ApiClient {
  /** Point the client at a base URL (a trailing `/` is dropped), optionally with credentials/fetch. */
  setApiBase(base: string, opts?: ApiClientOptions): void;
  /** Attach a portal/viewer token as `Authorization: Bearer …` on every request (`null` clears it). */
  setApiToken(token: string | null): void;
  /** The token set by {@link setApiToken}, or `null`. */
  getApiToken(): string | null;
  /** The URL for an API path under the current base. */
  apiUrl(path: string): string;
  /**
   * Fetch `path` and return the raw `Response` (for blobs, CSV, JWKS…). Throws the configured error
   * class for non-2xx responses.
   */
  send(path: string, init?: RequestInit): Promise<Response>;
  /** Fetch `path` and parse JSON; an empty body resolves to `undefined`. */
  req<T>(path: string, init?: RequestInit): Promise<T>;
  /** {@link toQuery}, for convenience. */
  query(params: Record<string, QueryValue>): string;
}

/**
 * Build a query string (`"?a=1&b=2"`, or `""` when nothing is left), skipping `undefined`, `null`
 * and `""`. Arrays are comma-joined (and skipped when empty); booleans become `"true"`/`"false"`.
 */
export function toQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object") {
      if (value.length) search.set(key, value.join(","));
    } else search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

async function errorBody(res: Response): Promise<ApiErrorBody> {
  const fallback = res.statusText || `HTTP ${res.status}`;
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { error: fallback, status: res.status };
  }
  const body =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const error = typeof body.error === "string" && body.error ? body.error : fallback;
  return { ...body, error, status: res.status };
}

/**
 * Create one product's API client. `errorClass` is the product's error class (it receives
 * `(status, body)`); it defaults to {@link ApiError}.
 *
 * ```ts
 * export class WebhooksApiError extends ApiError {}
 * const client = createApiClient({ errorClass: WebhooksApiError });
 * export const { setApiBase, setApiToken } = client;
 * export const listApps = () => client.req<App[]>("api/apps");
 * ```
 */
export function createApiClient(options: CreateApiClientOptions = {}): ApiClient {
  const ErrorClass = options.errorClass ?? ApiError;
  let base = (options.base ?? "").replace(/\/$/, "");
  let credentials: RequestCredentials = options.credentials ?? "same-origin";
  let fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  let token: string | null = null;

  const apiUrl = (path: string): string => (base ? `${base}/${path}` : path);

  const send = async (path: string, init?: RequestInit): Promise<Response> => {
    // Merge case-insensitively, so a caller's `content-type` (any casing, any HeadersInit shape)
    // replaces the JSON default instead of being sent alongside it.
    const headers = new Headers();
    // JSON by default for string bodies; callers sending CSV/FormData override or omit it.
    if (typeof init?.body === "string") headers.set("content-type", "application/json");
    if (token) headers.set("authorization", `Bearer ${token}`);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const res = await fetchImpl(apiUrl(path), {
      credentials,
      ...init,
      headers: Object.fromEntries(headers.entries()),
    });
    if (!res.ok) throw new ErrorClass(res.status, await errorBody(res));
    return res;
  };

  return {
    setApiBase(next, opts) {
      base = next.replace(/\/$/, "");
      if (opts?.credentials) credentials = opts.credentials;
      if (opts?.fetch) fetchImpl = opts.fetch;
    },
    setApiToken(next) {
      token = next;
    },
    getApiToken: () => token,
    apiUrl,
    send,
    async req<T>(path: string, init?: RequestInit): Promise<T> {
      const res = await send(path, init);
      const text = await res.text();
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    },
    query: toQuery,
  };
}
