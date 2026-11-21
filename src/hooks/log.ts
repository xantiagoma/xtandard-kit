/**
 * A reference hook that logs mutation events.
 *
 * The simplest possible consumer of the hooks seam: useful as a starting point
 * for your own `after` side effects, and handy for local debugging or piping
 * admin activity to a log aggregator (`json: true` prints one JSON object per
 * line). Zero dependencies.
 *
 * @example
 * ```ts
 * import { createLogHook } from "@xtandard/kit/hooks/log";
 *
 * const hook = createLogHook({ source: "@xtandard/flags", describe: (e) => e.projectKey });
 * ```
 *
 * @module
 */

import type { HookEvent, Hooks } from "./contract.ts";

/** Options for {@link createLogHook}. */
export interface LogHookOptions<
  Before extends HookEvent = HookEvent,
  After extends HookEvent = HookEvent,
> {
  /** Sink for each formatted line. Default: `console.log`. */
  log?: (line: string) => void;
  /** Also log `before` events (default `false` — `after` only). */
  includeBefore?: boolean;
  /**
   * Emit one JSON object per line (`{ "source", "phase", ...event }`) — for log
   * aggregators. Ignored when `format` is given. Default `false`.
   */
  json?: boolean;
  /** The `source` name in every line, usually the package name. Default `"@xtandard/kit"`. */
  source?: string;
  /**
   * Extra field printed after the event type in the text format, e.g. the
   * tenant or `project/env` the event belongs to. Omitted when it returns
   * `undefined` or an empty string.
   */
  describe?: (event: Before | After) => string | undefined;
  /**
   * Format a line for an event. Default: a compact
   * `[<source>] <phase> <type> [<describe>] ` prefix + JSON payload.
   */
  format?: (phase: "before" | "after", event: Before | After) => string;
}

/**
 * Build a hook that logs each mutation event. Never throws from `before`, so it
 * never denies a mutation — it is a pure observer.
 */
export function createLogHook<
  Before extends HookEvent = HookEvent,
  After extends HookEvent = HookEvent,
>(options: LogHookOptions<Before, After> = {}): Hooks<Before, After> {
  const log = options.log ?? ((line: string) => console.log(line));
  const source = options.source ?? "@xtandard/kit";
  const describe = options.describe;
  const textFormat = (phase: "before" | "after", event: Before | After): string => {
    const extra = describe?.(event);
    return `[${source}] ${phase} ${event.type}${extra ? ` ${extra}` : ""} ${JSON.stringify(event)}`;
  };
  const jsonFormat = (phase: "before" | "after", event: Before | After): string =>
    JSON.stringify({ source, phase, ...event });
  const format = options.format ?? (options.json ? jsonFormat : textFormat);
  const hook: Hooks<Before, After> = {
    after(event) {
      log(format("after", event));
    },
  };
  if (options.includeBefore) {
    hook.before = (event) => {
      log(format("before", event));
    };
  }
  return hook;
}
