import type { ActivityCell, LegendLabels } from '@/features/activity-grid/components/ActivityGrid';
import type { ActivityDayRow } from '@/features/activity-grid/components/ActivityDayList';
import type { ActivityStat } from '@/features/activity-grid/components/ActivityStats';
import { intensityLevel } from '@/features/activity-grid/grid';
import { addDays, compareDates, formatShortDate } from '@/lib/localDate';

import { formatLocalDate } from './date';
import type { FoodLogActivity } from './schema';

// Pure: turns the server's activity into the generic grid's input and labels (spec 14). Every date
// and bound comes from the server's today and from, never from the phone clock.

export const ACTIVITY_EMPTY = 'Your food photos will fill this grid. Add your first one.';
export const ACTIVITY_LIST_EMPTY = 'No uploads in this range yet.';
export const ACTIVITY_LEGEND: LegendLabels = {
  less: 'Less',
  more: 'More',
  spoken: 'Fewer to more uploads',
};

function uploads(count: number): string {
  if (count === 0) return 'no uploads';
  return count === 1 ? '1 upload' : `${count} uploads`;
}

function days(count: number): string {
  return count === 1 ? '1 day' : `${count} days`;
}

/** "Nov 12, 3 uploads", "Nov 12, 1 upload", "Nov 12, no uploads"; ", today" on today. */
export function cellLabel(date: string, count: number, isToday: boolean, locale?: string): string {
  return `${formatShortDate(date, locale)}, ${uploads(count)}${isToday ? ', today' : ''}`;
}

/** "Activity, last 17 weeks, 23 uploads". */
export function summaryLabel(weeks: number, total: number): string {
  return `Activity, last ${weeks} weeks, ${uploads(total)}`;
}

/** "Nothing logged on Thu, Nov 12, 2026." */
export function nothingLogged(date: string, locale?: string): string {
  return `Nothing logged on ${formatLocalDate(date, locale)}.`;
}

export type ActivityView = {
  /** A cell for every date from `from` to today. */
  cells: Record<string, ActivityCell>;
  /** The days with uploads, newest first (the list view). */
  rows: ActivityDayRow[];
  /** Uploads in the range. */
  total: number;
};

export function buildActivityView(activity: FoodLogActivity, locale?: string): ActivityView {
  const counts = new Map(activity.days.map((day) => [day.date, day.count]));
  const cells: Record<string, ActivityCell> = {};
  for (let date = activity.from; compareDates(date, activity.today) <= 0; date = addDays(date, 1)) {
    const count = counts.get(date) ?? 0;
    cells[date] = {
      level: intensityLevel(count),
      label: cellLabel(date, count, date === activity.today, locale),
    };
  }
  const rows = [...activity.days]
    .sort((a, b) => compareDates(b.date, a.date))
    .map((day) => ({
      date: day.date,
      label: cells[day.date]?.label ?? cellLabel(day.date, day.count, false, locale),
    }));
  const total = activity.days.reduce((sum, day) => sum + day.count, 0);
  return { cells, rows, total };
}

export function statItems(stats: FoodLogActivity['stats']): ActivityStat[] {
  return [
    {
      label: 'Total this year',
      value: String(stats.total_this_year),
      spokenLabel: `Total this year, ${uploads(stats.total_this_year)}`,
    },
    {
      label: 'Current streak',
      value: String(stats.current_streak),
      spokenLabel: `Current streak, ${days(stats.current_streak)}`,
    },
    {
      label: 'Longest streak',
      value: String(stats.longest_streak),
      spokenLabel: `Longest streak, ${days(stats.longest_streak)}`,
    },
    {
      label: 'Cuisines tried',
      value: String(stats.cuisines_tried),
      spokenLabel: `Cuisines tried, ${stats.cuisines_tried}`,
    },
  ];
}

/** A new person: nothing in the range and every stat 0 (the empty state, Decision 5). */
export function isEmptyActivity(activity: FoodLogActivity): boolean {
  const { stats } = activity;
  return (
    activity.days.length === 0 &&
    stats.total_this_year === 0 &&
    stats.current_streak === 0 &&
    stats.longest_streak === 0 &&
    stats.cuisines_tried === 0
  );
}

/** The day before, or null at the range's first day. */
export function previousDay(date: string, from: string): string | null {
  return compareDates(date, from) <= 0 ? null : addDays(date, -1);
}

/** The day after, or null at today (the range's last day). */
export function nextDay(date: string, today: string): string | null {
  return compareDates(date, today) >= 0 ? null : addDays(date, 1);
}
