import type { SessionDailyTokenUsage } from "../../../../core/types";

export type NaturalDatePreset = "today" | "yesterday" | "thisWeek" | "thisMonth" | "lastMonth";

export type ExactDateRange = Pick<SessionDailyTokenUsage, "dayStart" | "dayEndExclusive">;

export interface NaturalDatePresetOption {
  value: NaturalDatePreset;
  label: { en: string; zh: string };
}

export const NATURAL_DATE_PRESETS: NaturalDatePresetOption[] = [
  { value: "today", label: { en: "Today", zh: "今天" } },
  { value: "yesterday", label: { en: "Yesterday", zh: "昨天" } },
  { value: "thisWeek", label: { en: "This week", zh: "本周" } },
  { value: "thisMonth", label: { en: "This month", zh: "本月" } },
  { value: "lastMonth", label: { en: "Last month", zh: "上月" } },
];

/**
 * Resolves a natural calendar period to local-midnight boundaries. Weeks start
 * on Monday. Dates are built through the Date constructor (never millisecond
 * arithmetic) so month rollovers and DST transitions stay on day boundaries.
 */
export function naturalDateRange(preset: NaturalDatePreset, now: number = Date.now()): ExactDateRange {
  const current = new Date(now);
  const year = current.getFullYear();
  const month = current.getMonth();
  const dayOfMonth = current.getDate();
  const startOf = (dayOffset: number): number => new Date(year, month, dayOfMonth + dayOffset).getTime();
  switch (preset) {
    case "today":
      return { dayStart: startOf(0), dayEndExclusive: startOf(1) };
    case "yesterday":
      return { dayStart: startOf(-1), dayEndExclusive: startOf(0) };
    case "thisWeek":
      // getDay() is 0 for Sunday; shift so Monday becomes the week's first day.
      return { dayStart: startOf(-((current.getDay() + 6) % 7)), dayEndExclusive: startOf(7 - ((current.getDay() + 6) % 7)) };
    case "thisMonth":
      return { dayStart: new Date(year, month, 1).getTime(), dayEndExclusive: new Date(year, month + 1, 1).getTime() };
    case "lastMonth":
      return { dayStart: new Date(year, month - 1, 1).getTime(), dayEndExclusive: new Date(year, month, 1).getTime() };
  }
}

/**
 * Builds an exact range from input[type=date] values (always YYYY-MM-DD, which
 * must be parsed as local dates — new Date("YYYY-MM-DD") would use UTC). An
 * empty end date means the single start day; an end before the start is
 * clamped to the start day. Returns null when no start date is set.
 */
export function customDateRangeFromInputs(startValue: string, endValue: string): ExactDateRange | null {
  const start = parseLocalDate(startValue);
  if (!start) return null;
  const requestedEnd = parseLocalDate(endValue) ?? start;
  const end = requestedEnd < start ? start : requestedEnd;
  return {
    dayStart: start.getTime(),
    dayEndExclusive: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime(),
  };
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}
