import { DayOfWeek, type BusinessHour } from '@prisma/client';

/** Canonical Monday→Sunday ordering used for every schedule response. */
export const ORDERED_DAYS: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
  DayOfWeek.SUNDAY,
];

/** One day's hours in API form (present for all 7 days in a schedule). */
export interface WeeklyDay {
  dayOfWeek: DayOfWeek;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

export function serializeHour(row: BusinessHour): WeeklyDay {
  return {
    dayOfWeek: row.dayOfWeek,
    isClosed: row.isClosed,
    openTime: row.openTime,
    closeTime: row.closeTime,
  };
}

/**
 * Merge stored rows over the canonical week so a schedule always contains all
 * seven days in order. Missing days default to closed.
 */
export function buildWeeklySchedule(rows: BusinessHour[]): WeeklyDay[] {
  const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
  return ORDERED_DAYS.map((day) => {
    const row = byDay.get(day);
    return row
      ? serializeHour(row)
      : { dayOfWeek: day, isClosed: true, openTime: null, closeTime: null };
  });
}
