import { addDays, compareDates, dayOfWeek, formatShortMonth } from '@/lib/localDate';

// Pure helpers for the generic activity grid (spec 14). They know nothing about uploads: callers
// pass dates and counts. "today" is always passed in, never read from the phone clock.

export type IntensityLevel = 0 | 1 | 2 | 3;

/** 0 gives 0, 1 gives 1, 2 to 3 give 2, 4 or more give 3 (v1 section 11). */
export function intensityLevel(count: number): IntensityLevel {
  if (count >= 4) return 3;
  if (count >= 2) return 2;
  if (count >= 1) return 1;
  return 0;
}

/**
 * Columns of 7 dates, Sunday to Saturday, from the week of `from` to the week of `today`. Weeks
 * start on Sunday whatever the locale. The days after today are padding (see isAfterToday).
 */
export function buildWeeks(from: string, today: string): string[][] {
  const start = addDays(from, -dayOfWeek(from));
  const end = addDays(today, 6 - dayOfWeek(today));
  const weeks: string[][] = [];
  for (let sunday = start; compareDates(sunday, end) <= 0; sunday = addDays(sunday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(sunday, i)));
  }
  return weeks;
}

export function isAfterToday(date: string, today: string): boolean {
  return compareDates(date, today) > 0;
}

export type MonthLabel = { index: number; label: string };

/**
 * A short month name over each column that holds the 1st of a month. The first column is named
 * too, unless a 1st comes within the next two columns (the names would overlap).
 */
export function monthLabels(weeks: readonly (readonly string[])[], locale?: string): MonthLabel[] {
  const firsts = weeks.map((week) => week.find((date) => date.endsWith('-01')));
  const labels: MonthLabel[] = [];
  if (weeks.length > 0 && !firsts.slice(0, 3).some(Boolean)) {
    labels.push({ index: 0, label: formatShortMonth(weeks[0][0], locale) });
  }
  firsts.forEach((first, index) => {
    if (first) labels.push({ index, label: formatShortMonth(first, locale) });
  });
  return labels;
}
