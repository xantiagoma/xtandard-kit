/**
 * Pure formatting helpers shared by the admin views — no React, no DOM. Missing or invalid input
 * renders as `"—"`.
 *
 * @module
 */

/** Options for {@link formatDateTime}. */
export interface FormatDateTimeOptions {
  /** Include seconds (wh/au style). Default `false` (li/en style). */
  seconds?: boolean;
  /** BCP 47 locale; the user's locale by default. */
  locale?: string;
  /** IANA time zone; the user's by default. */
  timeZone?: string;
}

function parseDate(input: string | number | Date | undefined | null): Date | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Absolute date-time, locale-aware (`"Nov 21, 2026, 03:04 PM"`). */
export function formatDateTime(
  input: string | number | Date | undefined | null,
  options: FormatDateTimeOptions = {},
): string {
  const date = parseDate(input);
  if (!date) return "—";
  return new Intl.DateTimeFormat(options.locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" } : {}),
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(date);
}

/** Short date, locale-aware (`"Nov 21, 2026"`). */
export function formatDate(
  input: string | number | Date | undefined | null,
  options: Omit<FormatDateTimeOptions, "seconds"> = {},
): string {
  const date = parseDate(input);
  if (!date) return "—";
  return new Intl.DateTimeFormat(options.locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(date);
}

const RELATIVE_UNITS: [number, string][] = [
  [1000, "s"],
  [60_000, "m"],
  [3_600_000, "h"],
  [86_400_000, "d"],
  [30 * 86_400_000, "mo"],
  [365 * 86_400_000, "y"],
];

/**
 * Compact relative time: `"just now"`, `"5m ago"`, `"in 2h"`, `"3d ago"`, `"2mo ago"`, `"1y ago"`.
 * Values are floored, so `"1h ago"` means at least one full hour. `now` is injectable for tests.
 */
export function relativeTime(
  input: string | number | Date | undefined | null,
  now: number = Date.now(),
): string {
  const date = parseDate(input);
  if (!date) return "—";
  const diff = now - date.getTime();
  const abs = Math.abs(diff);
  if (abs < 10_000) return "just now";
  let value = Math.floor(abs / 1000);
  let unit = "s";
  for (const [ms, label] of RELATIVE_UNITS) {
    if (abs >= ms) {
      value = Math.floor(abs / ms);
      unit = label;
    }
  }
  return diff >= 0 ? `${value}${unit} ago` : `in ${value}${unit}`;
}

/** Truncate with an ellipsis; never longer than `max` characters (including the ellipsis). */
export function truncate(text: string, max: number): string {
  if (max <= 1) return text.length > max ? "…" : text;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Up to two initials for an avatar: `"Ada Lovelace"` → `"AL"`, `"ada.lovelace@x.com"` → `"AL"`
 * (the email domain is ignored), `"?"` when nothing is left.
 */
export function initials(name: string | undefined | null): string {
  if (!name) return "?";
  const words = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((w) => [...w][0]!.toUpperCase())
      .join("") || "?"
  );
}

/** A whole number with grouping (`12,345`); rounds fractions. */
export function formatCount(n: number | undefined | null, locale = "en-US"): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(locale).format(Math.round(n));
}

/** A number with grouping and up to `maxFractionDigits` decimals (`1,234.5`). */
export function formatNumber(
  n: number | undefined | null,
  maxFractionDigits = 2,
  locale = "en-US",
): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: maxFractionDigits }).format(n);
}

/** Compact number for tight spaces (`950`, `1.2K`, `34K`, `1.5M`, `2B`). */
export function formatCompact(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  const [div, suffix] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : [1e3, "K"];
  const v = n / div;
  const digits = Math.abs(v) < 10 ? 1 : 0;
  return `${v.toFixed(digits).replace(/\.0$/, "")}${suffix}`;
}

/** A duration in milliseconds: `"87 ms"` below a second, `"1.25 s"` above. */
export function formatDurationMs(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, "")} s`;
}
