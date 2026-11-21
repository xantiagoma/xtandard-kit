/**
 * The shared format helpers.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import {
  formatCompact,
  formatCount,
  formatDate,
  formatDateTime,
  formatDurationMs,
  formatNumber,
  initials,
  relativeTime,
  truncate,
} from "../src/ui/format.ts";

const at = "2026-03-04T05:06:07Z";

describe("dates", () => {
  it("formats date-times with or without seconds", () => {
    const base = { locale: "en-US", timeZone: "UTC" };
    expect(formatDateTime(at, base)).toBe("Mar 4, 2026, 05:06 AM");
    expect(formatDateTime(at, { ...base, seconds: true })).toBe("Mar 4, 2026, 05:06:07 AM");
    expect(formatDateTime(new Date(at), base)).toBe("Mar 4, 2026, 05:06 AM");
    expect(formatDate(Date.parse(at), base)).toBe("Mar 4, 2026");
  });

  it("renders missing or invalid input as a dash", () => {
    for (const v of [undefined, null, "", "nope"]) {
      expect(formatDateTime(v)).toBe("—");
      expect(formatDate(v)).toBe("—");
      expect(relativeTime(v)).toBe("—");
    }
  });

  it("relativeTime", () => {
    const now = Date.parse(at);
    const ago = (ms: number) => relativeTime(new Date(now - ms).toISOString(), now);
    expect(ago(5_000)).toBe("just now");
    expect(ago(45_000)).toBe("45s ago");
    expect(ago(5 * 60_000)).toBe("5m ago");
    expect(ago(119 * 60_000)).toBe("1h ago");
    expect(ago(3 * 86_400_000)).toBe("3d ago");
    expect(ago(65 * 86_400_000)).toBe("2mo ago");
    expect(ago(400 * 86_400_000)).toBe("1y ago");
    expect(ago(-2 * 3_600_000)).toBe("in 2h");
  });
});

describe("text and numbers", () => {
  it("truncate", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
    expect(truncate("abc", 1)).toBe("…");
    expect(truncate("a", 1)).toBe("a");
  });

  it("initials", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("ada.lovelace@x.com")).toBe("AL");
    expect(initials("élise")).toBe("É");
    expect(initials("")).toBe("?");
    expect(initials("@x.com")).toBe("?");
    expect(initials(null)).toBe("?");
  });

  it("formatCount / formatNumber / formatCompact", () => {
    expect(formatCount(12345.6)).toBe("12,346");
    expect(formatNumber(1234.567)).toBe("1,234.57");
    expect(formatNumber(1234.5, 0)).toBe("1,235");
    expect(formatCompact(950)).toBe("950");
    expect(formatCompact(1234)).toBe("1.2K");
    expect(formatCompact(34_000)).toBe("34K");
    expect(formatCompact(1_500_000)).toBe("1.5M");
    expect(formatCompact(2e9)).toBe("2B");
    for (const v of [undefined, null, Number.NaN, Infinity]) {
      expect(formatCount(v)).toBe("—");
      expect(formatNumber(v)).toBe("—");
      expect(formatCompact(v)).toBe("—");
    }
  });

  it("formatDurationMs", () => {
    expect(formatDurationMs(87.4)).toBe("87 ms");
    expect(formatDurationMs(1250)).toBe("1.25 s");
    expect(formatDurationMs(2000)).toBe("2 s");
    expect(formatDurationMs(-1)).toBe("—");
    expect(formatDurationMs(null)).toBe("—");
  });
});
