import { addDays, dayOfWeek } from '@/lib/localDate';

import { buildWeeks, intensityLevel, isAfterToday, monthLabels } from '../grid';

// The app's tsconfig loads no Node types, so the Node calls are typed here (as in
// mediaIsolation.test.ts). __dirname is set by jest's module wrapper.
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path') as { resolve: (...segments: string[]) => string };

/** The server's range start for `weeks` weeks ending in today's week (the migration's formula). */
function serverFrom(today: string, weeks: number): string {
  return addDays(today, -dayOfWeek(today) - 7 * (weeks - 1));
}

/** Every column is Sunday..Saturday and the whole range has no gap and no repeat. */
function expectContinuous(weeks: string[][]) {
  const flat = weeks.flat();
  weeks.forEach((week) => {
    expect(week).toHaveLength(7);
    expect(dayOfWeek(week[0])).toBe(0);
    expect(dayOfWeek(week[6])).toBe(6);
  });
  flat.forEach((date, i) => {
    if (i > 0) expect(date).toBe(addDays(flat[i - 1], 1));
  });
  expect(new Set(flat).size).toBe(flat.length);
}

describe('intensityLevel', () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [99, 3],
  ])('%i uploads give level %i', (count, level) => {
    expect(intensityLevel(count)).toBe(level);
  });
});

describe('buildWeeks', () => {
  // 2026-11-08 is a Sunday, 2026-11-14 a Saturday.
  it.each([
    '2026-11-08',
    '2026-11-09',
    '2026-11-10',
    '2026-11-11',
    '2026-11-12',
    '2026-11-13',
    '2026-11-14',
  ])('gives 17 Sunday-to-Saturday weeks ending in the week of %s', (today) => {
    const weeks = buildWeeks(serverFrom(today, 17), today);
    expect(weeks).toHaveLength(17);
    expectContinuous(weeks);
    const last = weeks[16];
    expect(last).toContain(today);
    // The padding is exactly the days after today.
    const padding = weeks.flat().filter((date) => isAfterToday(date, today));
    expect(padding).toHaveLength(6 - dayOfWeek(today));
    expect(weeks.flat().filter((date) => !isAfterToday(date, today))).toHaveLength(
      7 * 17 - (6 - dayOfWeek(today)),
    );
  });

  it('gives 53 weeks (at most 371 days) for the full year', () => {
    const weeks = buildWeeks(serverFrom('2026-11-14', 53), '2026-11-14');
    expect(weeks).toHaveLength(53);
    expect(weeks.flat()).toHaveLength(371);
    expectContinuous(weeks);
  });

  it('gives one week for weeks = 1', () => {
    const weeks = buildWeeks(serverFrom('2026-11-12', 1), '2026-11-12');
    expect(weeks).toEqual([
      [
        '2026-11-08',
        '2026-11-09',
        '2026-11-10',
        '2026-11-11',
        '2026-11-12',
        '2026-11-13',
        '2026-11-14',
      ],
    ]);
  });

  it('crosses a month end', () => {
    const weeks = buildWeeks(serverFrom('2026-03-02', 2), '2026-03-02');
    expect(weeks).toHaveLength(2);
    expectContinuous(weeks);
    expect(weeks.flat()).toEqual(expect.arrayContaining(['2026-02-28', '2026-03-01']));
  });

  it('crosses a year end', () => {
    const weeks = buildWeeks(serverFrom('2027-01-02', 2), '2027-01-02');
    expectContinuous(weeks);
    expect(weeks.flat()).toEqual(expect.arrayContaining(['2026-12-31', '2027-01-01']));
    expect(weeks[1][6]).toBe('2027-01-02');
  });

  // America/Toronto: clocks went forward on Sun 2025-03-09 and back on Sun 2025-11-02. Dates have
  // no hours, so the 23- and 25-hour days are ordinary columns.
  it.each(['2025-03-09', '2025-03-12', '2025-11-02', '2025-11-05'])(
    'has no gap and no repeated day across a clock change (today %s)',
    (today) => {
      const weeks = buildWeeks(serverFrom(today, 17), today);
      expect(weeks).toHaveLength(17);
      expectContinuous(weeks);
    },
  );

  it('holds both clock-change Sundays in a 53-week range', () => {
    const flat = buildWeeks(serverFrom('2025-12-31', 53), '2025-12-31').flat();
    expect(flat).toEqual(expect.arrayContaining(['2025-03-08', '2025-03-09', '2025-03-10']));
    expect(flat).toEqual(expect.arrayContaining(['2025-11-01', '2025-11-02', '2025-11-03']));
    expect(flat.filter((date) => date === '2025-11-02')).toHaveLength(1);
  });

  it('starts on Sunday even when from is not one', () => {
    expect(buildWeeks('2026-11-11', '2026-11-12')[0][0]).toBe('2026-11-08');
  });
});

describe('monthLabels', () => {
  it('names each column holding the 1st of a month', () => {
    const weeks = buildWeeks(serverFrom('2026-11-14', 17), '2026-11-14');
    const labels = monthLabels(weeks, 'en-US');
    const firstCols = weeks
      .map((week, index) => (week.some((date) => date.endsWith('-01')) ? index : -1))
      .filter((index) => index >= 0);
    expect(labels.filter((l) => firstCols.includes(l.index)).map((l) => l.label)).toEqual([
      'Aug',
      'Sep',
      'Oct',
      'Nov',
    ]);
  });

  it('names the first column when no 1st is near it', () => {
    // From Sun 2026-07-19: the next 1st (Aug 1) is in column 1, so column 0 is not named.
    const near = monthLabels(buildWeeks('2026-07-19', '2026-08-15'), 'en-US');
    expect(near.map((l) => l.index)).toEqual([1]);
    // From Sun 2026-07-05: Aug 1 is in column 3, so column 0 is named Jul.
    const far = monthLabels(buildWeeks('2026-07-05', '2026-08-15'), 'en-US');
    expect(far[0]).toEqual({ index: 0, label: 'Jul' });
  });

  it('gives nothing for no weeks', () => {
    expect(monthLabels([], 'en-US')).toEqual([]);
  });
});

describe('the phone clock never decides a date', () => {
  it.each([
    ['grid.ts', path.resolve(__dirname, '../grid.ts')],
    ['localDate.ts', path.resolve(__dirname, '../../../lib/localDate.ts')],
  ])('%s reads no clock and no local-zone getter', (_name, file) => {
    const source = fs.readFileSync(file, 'utf8');
    expect(source).not.toMatch(/new Date\(\s*\)/);
    expect(source).not.toMatch(/Date\.now\(/);
    expect(source).not.toMatch(/\.get(Date|Day|Month|FullYear|Hours)\(/);
  });
});
