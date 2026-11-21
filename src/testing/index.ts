/**
 * Generic test helpers: a controllable clock and a collecting sink. The
 * products build their own fixtures (`createTestWebhooks`, `createTestAudit`…)
 * on top.
 *
 * @module
 */

import { durationToMs, type Duration } from "../util/duration.ts";

/** A manually driven clock. */
export interface TestClock {
  /** Current time (unix ms) — pass `clock.now` as a `now` option. */
  now(): number;
  /** Set the time (ISO string or unix ms). */
  set(at: string | number): void;
  /** Move forward. */
  advance(by: Duration): void;
  /** Current time as ISO. */
  iso(): string;
}

const toMs = (at: string | number): number => {
  const ms = typeof at === "string" ? Date.parse(at) : at;
  if (!Number.isFinite(ms)) throw new TypeError(`TestClock: invalid time ${String(at)}`);
  return ms;
};

/**
 * Create a {@link TestClock} starting at `start` (default: real now).
 *
 * @example
 * ```ts
 * const clock = createTestClock("2026-01-01T00:00:00Z");
 * clock.advance("1h");
 * clock.iso(); // "2026-01-01T01:00:00.000Z"
 * ```
 */
export function createTestClock(start: string | number = Date.now()): TestClock {
  let t = toMs(start);
  return {
    now: () => t,
    set: (at) => {
      t = toMs(at);
    },
    advance: (by) => {
      t += durationToMs(by);
    },
    iso: () => new Date(t).toISOString(),
  };
}

/** A sink that keeps everything it receives, with programmable failures. */
export interface CollectingSink<T> {
  /** Everything received so far, in order. */
  readonly items: T[];
  /** Receive items. Rejects instead while failures are programmed with {@link CollectingSink.failNext}. */
  push(...items: T[]): Promise<void>;
  /** Make the next `n` pushes reject with `error` (to exercise retry paths). */
  failNext(n?: number, error?: Error): void;
  /** Forget everything received. */
  clear(): void;
}

/** Options for {@link collectingSink}. */
export interface CollectingSinkOptions {
  /** Store a `structuredClone` of each item, so later mutation by the caller doesn't show. Default `false`. */
  clone?: boolean;
}

/**
 * Create a {@link CollectingSink}.
 *
 * @example
 * ```ts
 * const sink = collectingSink<AuditEvent>();
 * const stream = { kind: "collecting", send: (batch) => sink.push(...batch.events) };
 * sink.failNext(2); // the next two sends reject
 * ```
 */
export function collectingSink<T>(options: CollectingSinkOptions = {}): CollectingSink<T> {
  const items: T[] = [];
  let failures = { remaining: 0, error: new Error() };
  return {
    items,
    async push(...received) {
      if (failures.remaining > 0) {
        failures.remaining--;
        throw failures.error;
      }
      for (const item of received) items.push(options.clone ? structuredClone(item) : item);
    },
    failNext(n = 1, error = new Error("collectingSink: simulated failure")) {
      failures = { remaining: n, error };
    },
    clear() {
      items.length = 0;
    },
  };
}
