/**
 * The hooks runner shared by every product: `before` hooks run before a write
 * commits and may deny it, `after` hooks run once it has committed.
 *
 * - `before` runs **sequentially**. Throw to deny (e.g. {@link HookDeniedError});
 *   the first throw aborts the remaining hooks and propagates to the caller.
 * - `after` runs **concurrently**. Errors are isolated and reported through a
 *   {@link HookErrorReporter}; they never reach the caller.
 *
 * The event unions are product data: the runner is generic over
 * `Before extends { type: string }` and `After extends { type: string }`.
 *
 * @module
 */

/** Throw from a `before` hook to deny with a status (default 403). */
export class HookDeniedError extends Error {
  /** HTTP status the API layer should respond with. Default `403`. */
  readonly status: number;
  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "HookDeniedError";
    this.status = options?.status ?? 403;
  }
}

/** The minimum shape of a hook event: a `type` discriminant. */
export interface HookEvent {
  type: string;
}

/** A hook: implement either side or both. */
export interface Hooks<Before extends HookEvent = HookEvent, After extends HookEvent = HookEvent> {
  before?(event: Before): void | Promise<void>;
  after?(event: After): void | Promise<void>;
}

/** Accepts a single hook, an array, or nothing. */
export type HooksInput<Before extends HookEvent = HookEvent, After extends HookEvent = HookEvent> =
  | Hooks<Before, After>
  | readonly Hooks<Before, After>[]
  | undefined;

/** Reports an error thrown by an `after` hook. */
export type HookErrorReporter<After extends HookEvent = HookEvent> = (
  error: unknown,
  event: After,
) => void;

/** Normalize the `hooks` option into a flat array (empty when unset). */
export function normalizeHooks<Before extends HookEvent, After extends HookEvent>(
  input: HooksInput<Before, After>,
): Hooks<Before, After>[] {
  if (!input) return [];
  return Array.isArray(input) ? [...input] : [input as Hooks<Before, After>];
}

/** Run `before` hooks sequentially; the first throw denies. */
export async function runBefore<Before extends HookEvent>(
  hooks: readonly Hooks<Before, never>[],
  event: Before,
): Promise<void> {
  for (const hook of hooks) {
    if (hook.before) await hook.before(event);
  }
}

/** Run `after` hooks concurrently; errors go to `onError`, never to the caller. */
export async function runAfter<After extends HookEvent>(
  hooks: readonly Hooks<never, After>[],
  event: After,
  onError: HookErrorReporter<After>,
): Promise<void> {
  await Promise.all(
    hooks.map(async (hook) => {
      if (!hook.after) return;
      try {
        await hook.after(event);
      } catch (error) {
        onError(error, event);
      }
    }),
  );
}

/**
 * Build an `after`-hook error reporter that warns with `[source]` as the log
 * prefix and never throws. Products pass their package name:
 * `createHookErrorReporter("@xtandard/webhooks")`.
 */
export function createHookErrorReporter(source: string): HookErrorReporter {
  return (error, event) => {
    console.warn(`[${source}] after-hook for "${event.type}" threw:`, error);
  };
}

/** Default `after`-hook error reporter: warns with the `[@xtandard/kit]` prefix, never throws. */
export const defaultHookErrorReporter: HookErrorReporter = createHookErrorReporter("@xtandard/kit");

/**
 * True when `error` is an error object whose `name` is `name`. Use it instead
 * of `instanceof` to map domain errors to HTTP statuses: an error class loaded
 * from a separate bundle (another subpath's copy of the class, or another
 * realm) fails `instanceof` but keeps its `name`.
 *
 * @example
 * ```ts
 * if (isNamed(err, "NotFoundError")) return error(404, err.message, { code: "NOT_FOUND" });
 * ```
 */
export function isNamed(error: unknown, name: string): error is Error {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === name;
}

/**
 * The status of a hook denial — a {@link HookDeniedError}, or a foreign-bundle
 * copy of it recognised by name (default 403 when it carries no numeric
 * `status`) — or `null` when `error` is not a denial.
 */
export function hookDeniedStatus(error: unknown): number | null {
  if (!isNamed(error, "HookDeniedError")) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : 403;
}
