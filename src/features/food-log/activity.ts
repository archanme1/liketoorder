import type { ActivityCell, LegendLabels } from '@/features/activity-grid/components/ActivityGrid';
import type { ActivityDayRow } from '@/features/activity-grid/components/ActivityDayList';
import type { ActivityStat } from '@/features/activity-grid/components/ActivityStats';
import { intensityLevel } from '@/features/activity-grid/grid';
import { UNKNOWN_CUISINE } from '@/features/cuisines/components/CuisineLabel';
import {
  FALLBACK_CUISINE_ICON,
  type Cuisine,
  type CuisineIconName,
} from '@/features/cuisines/schema';
import { addDays, compareDates, formatShortDate } from '@/lib/localDate';

import { formatLocalDate } from './date';
import type { FoodLogActivity, FoodLogCuisineDays } from './schema';

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

// The Cuisine view (spec 15): the same squares, each day showing its one cuisine's flag or icon,
// or the globe when it has more than one. Escapes keep the source ASCII.

export const GLOBE = '\u{1F30D}';
export const LEGEND_SEPARATOR = '\u00B7';
export const CUISINE_LEGEND = {
  one: 'One cuisine: its flag or icon',
  more: 'More than one',
  spoken: 'A flag or icon shows a day with one cuisine; a globe shows a day with more than one',
} as const;

export type ActivityViewName = 'activity' | 'cuisine';

/** The Your year route's `view` param: only "cuisine" opens the Cuisine view. */
export function parseActivityView(param: unknown): ActivityViewName {
  return param === 'cuisine' ? 'cuisine' : 'activity';
}

export type CuisineGlyphKind =
  { kind: 'flag'; flag: string } | { kind: 'icon'; icon: CuisineIconName } | { kind: 'globe' };

type CuisineDay = FoodLogCuisineDays['days'][number];

/**
 * "Nov 12, Italy, 2 uploads", "Nov 12, 3 cuisines, 4 uploads"; ", today" on today. A day without
 * uploads keeps spec 14's "Nov 12, no uploads".
 */
export function cuisineCellLabel(
  date: string,
  day: Pick<CuisineDay, 'count' | 'cuisines'> | undefined,
  cuisineName: string,
  isToday: boolean,
  locale?: string,
): string {
  if (!day) return cellLabel(date, 0, isToday, locale);
  const what = day.cuisines === 1 ? cuisineName : `${day.cuisines} cuisines`;
  return `${formatShortDate(date, locale)}, ${what}, ${uploads(day.count)}${isToday ? ', today' : ''}`;
}

/** "Cuisines, last 17 weeks, 23 uploads". */
export function cuisineSummaryLabel(weeks: number, total: number): string {
  return `Cuisines, last ${weeks} weeks, ${uploads(total)}`;
}

export type CuisineCell = { label: string; glyph: CuisineGlyphKind | null };

export type CuisineView = {
  /** A cell for every date from `from` to today; glyph null on a day without uploads. */
  cells: Record<string, CuisineCell>;
  /** The days with uploads, newest first (the list view). */
  rows: ActivityDayRow[];
  /** Uploads in the range. */
  total: number;
};

/** One cuisine: a country's flag or a neutral cuisine's icon; a code not in the catalog, the fallback. */
function singleCuisine(code: string | null, catalog: readonly Cuisine[]) {
  const cuisine = code ? catalog.find((item) => item.code === code) : undefined;
  if (cuisine?.kind === 'country') {
    return { name: cuisine.name, glyph: { kind: 'flag', flag: cuisine.flag } as const };
  }
  if (cuisine?.kind === 'neutral') {
    return { name: cuisine.name, glyph: { kind: 'icon', icon: cuisine.icon } as const };
  }
  return { name: UNKNOWN_CUISINE, glyph: { kind: 'icon', icon: FALLBACK_CUISINE_ICON } as const };
}

export function buildCuisineView(
  cuisineDays: FoodLogCuisineDays,
  catalog: readonly Cuisine[],
  locale?: string,
): CuisineView {
  const byDate = new Map(cuisineDays.days.map((day) => [day.date, day]));
  const cells: Record<string, CuisineCell> = {};
  for (
    let date = cuisineDays.from;
    compareDates(date, cuisineDays.today) <= 0;
    date = addDays(date, 1)
  ) {
    const day = byDate.get(date);
    const isToday = date === cuisineDays.today;
    if (!day) {
      cells[date] = { label: cuisineCellLabel(date, undefined, '', isToday, locale), glyph: null };
    } else if (day.cuisines === 1) {
      const one = singleCuisine(day.cuisine, catalog);
      cells[date] = {
        label: cuisineCellLabel(date, day, one.name, isToday, locale),
        glyph: one.glyph,
      };
    } else {
      cells[date] = {
        label: cuisineCellLabel(date, day, '', isToday, locale),
        glyph: { kind: 'globe' },
      };
    }
  }
  const rows = [...cuisineDays.days]
    .sort((a, b) => compareDates(b.date, a.date))
    .flatMap((day) => {
      const cell = cells[day.date];
      return cell ? [{ date: day.date, label: cell.label }] : [];
    });
  const total = cuisineDays.days.reduce((sum, day) => sum + day.count, 0);
  return { cells, rows, total };
}
