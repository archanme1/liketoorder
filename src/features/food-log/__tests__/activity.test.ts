import {
  ACTIVITY_LEGEND,
  buildActivityView,
  cellLabel,
  isEmptyActivity,
  nextDay,
  nothingLogged,
  previousDay,
  statItems,
  summaryLabel,
} from '../activity';
import type { FoodLogActivity } from '../schema';

// Shaped like get_my_food_log_activity's JSON (the migration's jsonb_build_object keys).
function activity(overrides: Partial<FoodLogActivity> = {}): FoodLogActivity {
  return {
    today: '2026-11-12',
    from: '2026-07-19',
    days: [
      { date: '2026-11-03', count: 1 },
      { date: '2026-11-10', count: 2 },
      { date: '2026-11-11', count: 4 },
      { date: '2026-11-12', count: 3 },
    ],
    stats: { total_this_year: 40, current_streak: 3, longest_streak: 9, cuisines_tried: 6 },
    ...overrides,
  };
}

describe('labels', () => {
  it('reads a cell as "Nov 12, 3 uploads", with ", today" on today', () => {
    expect(cellLabel('2026-11-12', 3, false, 'en-US')).toBe('Nov 12, 3 uploads');
    expect(cellLabel('2026-11-12', 1, false, 'en-US')).toBe('Nov 12, 1 upload');
    expect(cellLabel('2026-11-12', 0, false, 'en-US')).toBe('Nov 12, no uploads');
    expect(cellLabel('2026-11-12', 0, true, 'en-US')).toBe('Nov 12, no uploads, today');
  });

  it('gives the summary and the empty day line', () => {
    expect(summaryLabel(17, 23)).toBe('Activity, last 17 weeks, 23 uploads');
    expect(summaryLabel(53, 1)).toBe('Activity, last 53 weeks, 1 upload');
    expect(nothingLogged('2026-11-12', 'en-US')).toBe('Nothing logged on Thu, Nov 12, 2026.');
  });

  it('speaks the legend', () => {
    expect(ACTIVITY_LEGEND).toEqual({
      less: 'Less',
      more: 'More',
      spoken: 'Fewer to more uploads',
    });
  });
});

describe('buildActivityView', () => {
  it('gives a cell for every date from `from` to the server today, and none after', () => {
    const { cells } = buildActivityView(activity(), 'en-US');
    const dates = Object.keys(cells);
    expect(dates[0]).toBe('2026-07-19');
    expect(dates[dates.length - 1]).toBe('2026-11-12');
    expect(dates).toHaveLength(117);
    expect(cells['2026-11-13']).toBeUndefined();
  });

  it('levels by count and labels each day', () => {
    const { cells } = buildActivityView(activity(), 'en-US');
    expect(cells['2026-11-03']).toEqual({ level: 1, label: 'Nov 3, 1 upload' });
    expect(cells['2026-11-10']).toEqual({ level: 2, label: 'Nov 10, 2 uploads' });
    expect(cells['2026-11-11']).toEqual({ level: 3, label: 'Nov 11, 4 uploads' });
    expect(cells['2026-11-12']).toEqual({ level: 2, label: 'Nov 12, 3 uploads, today' });
    expect(cells['2026-11-04']).toEqual({ level: 0, label: 'Nov 4, no uploads' });
  });

  it('lists only the days with uploads, newest first, and totals the range', () => {
    const { rows, total } = buildActivityView(activity(), 'en-US');
    expect(rows.map((row) => row.date)).toEqual([
      '2026-11-12',
      '2026-11-11',
      '2026-11-10',
      '2026-11-03',
    ]);
    expect(rows[1].label).toBe('Nov 11, 4 uploads');
    expect(total).toBe(10);
  });

  it('ends at the server today whatever the phone clock says', () => {
    // A server today years from the real clock: the range still ends there.
    const { cells } = buildActivityView(
      activity({ today: '2020-06-10', from: '2020-02-16', days: [] }),
      'en-US',
    );
    const dates = Object.keys(cells);
    expect(dates[dates.length - 1]).toBe('2020-06-10');
    expect(cells['2020-06-10'].label).toBe('Jun 10, no uploads, today');
  });
});

describe('stats', () => {
  it('gives each stat as text with one spoken label', () => {
    expect(statItems(activity().stats)).toEqual([
      { label: 'Total this year', value: '40', spokenLabel: 'Total this year, 40 uploads' },
      { label: 'Current streak', value: '3', spokenLabel: 'Current streak, 3 days' },
      { label: 'Longest streak', value: '9', spokenLabel: 'Longest streak, 9 days' },
      { label: 'Cuisines tried', value: '6', spokenLabel: 'Cuisines tried, 6' },
    ]);
  });

  it('says "1 day" and "1 upload"', () => {
    const items = statItems({
      total_this_year: 1,
      current_streak: 1,
      longest_streak: 1,
      cuisines_tried: 1,
    });
    expect(items.map((item) => item.spokenLabel)).toEqual([
      'Total this year, 1 upload',
      'Current streak, 1 day',
      'Longest streak, 1 day',
      'Cuisines tried, 1',
    ]);
  });
});

describe('isEmptyActivity', () => {
  const zero = { total_this_year: 0, current_streak: 0, longest_streak: 0, cuisines_tried: 0 };

  it('is true only with no days and every stat 0', () => {
    expect(isEmptyActivity(activity({ days: [], stats: zero }))).toBe(true);
    expect(isEmptyActivity(activity({ stats: zero }))).toBe(false);
    expect(isEmptyActivity(activity({ days: [], stats: { ...zero, longest_streak: 2 } }))).toBe(
      false,
    );
  });
});

describe('previousDay and nextDay', () => {
  it('stay inside the range', () => {
    expect(previousDay('2026-11-12', '2026-07-19')).toBe('2026-11-11');
    expect(previousDay('2026-07-19', '2026-07-19')).toBeNull();
    expect(nextDay('2026-11-11', '2026-11-12')).toBe('2026-11-12');
    expect(nextDay('2026-11-12', '2026-11-12')).toBeNull();
  });
});
