import { describe, expect, it, vi } from "vitest";
import { customDateRangeFromInputs, NATURAL_DATE_PRESETS, naturalDateRange } from "./date-presets";

// 2026-10-13 is a Tuesday; its Monday-start week is Oct 12–18.
const NOW = new Date(2026, 9, 13, 15, 30, 12).getTime();

describe("naturalDateRange", () => {
  it.each([
    { preset: "today", start: [2026, 9, 13], end: [2026, 9, 14] },
    { preset: "yesterday", start: [2026, 9, 12], end: [2026, 9, 13] },
    { preset: "thisWeek", start: [2026, 9, 12], end: [2026, 9, 19] },
    { preset: "thisMonth", start: [2026, 9, 1], end: [2026, 10, 1] },
    { preset: "lastMonth", start: [2026, 8, 1], end: [2026, 9, 1] },
  ] as const)("resolves $preset to local calendar boundaries", ({ preset, start, end }) => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const range = naturalDateRange(preset);
    expect(range.dayStart).toBe(new Date(start[0], start[1], start[2]).getTime());
    expect(range.dayEndExclusive).toBe(new Date(end[0], end[1], end[2]).getTime());
  });

  it("resolves month and year rollover through January", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date(2027, 0, 8, 3, 0, 0).getTime());
    expect(naturalDateRange("lastMonth")).toEqual({
      dayStart: new Date(2026, 11, 1).getTime(),
      dayEndExclusive: new Date(2027, 0, 1).getTime(),
    });
  });

  it("honors an explicit now for stable resolution", () => {
    expect(naturalDateRange("today", NOW)).toEqual({
      dayStart: new Date(2026, 9, 13).getTime(),
      dayEndExclusive: new Date(2026, 9, 14).getTime(),
    });
  });
});

describe("NATURAL_DATE_PRESETS", () => {
  it("lists the five periods with localized labels", () => {
    expect(NATURAL_DATE_PRESETS.map((preset) => preset.label.en)).toEqual([
      "Today",
      "Yesterday",
      "This week",
      "This month",
      "Last month",
    ]);
    expect(NATURAL_DATE_PRESETS.map((preset) => preset.label.zh)).toEqual([
      "今天",
      "昨天",
      "本周",
      "本月",
      "上月",
    ]);
  });
});

describe("customDateRangeFromInputs", () => {
  it("builds an exclusive end from the inclusive last day", () => {
    expect(customDateRangeFromInputs("2026-09-30", "2026-10-02")).toEqual({
      dayStart: new Date(2026, 8, 30).getTime(),
      dayEndExclusive: new Date(2026, 9, 3).getTime(),
    });
  });

  it("treats a missing end as the single start day", () => {
    expect(customDateRangeFromInputs("2026-10-05", "")).toEqual({
      dayStart: new Date(2026, 9, 5).getTime(),
      dayEndExclusive: new Date(2026, 9, 6).getTime(),
    });
  });

  it("clamps an end earlier than the start to a single day", () => {
    expect(customDateRangeFromInputs("2026-10-05", "2026-10-01")).toEqual({
      dayStart: new Date(2026, 9, 5).getTime(),
      dayEndExclusive: new Date(2026, 9, 6).getTime(),
    });
  });

  it("returns null without a start date", () => {
    expect(customDateRangeFromInputs("", "2026-10-02")).toBeNull();
    expect(customDateRangeFromInputs("", "")).toBeNull();
  });
});
