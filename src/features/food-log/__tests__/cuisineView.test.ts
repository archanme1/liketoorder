import { FALLBACK_CUISINE_ICON } from '@/features/cuisines/schema';

import { CUISINES_WITH_NEUTRAL, cuisineDaysJson } from '../__fixtures__/foodLog';
import {
  buildCuisineView,
  CUISINE_LEGEND,
  cuisineCellLabel,
  cuisineSummaryLabel,
  GLOBE,
  LEGEND_SEPARATOR,
  parseActivityView,
} from '../activity';

const ITALY_FLAG = String.fromCodePoint(0x1f1ee, 0x1f1f9);
const JAPAN_FLAG = String.fromCodePoint(0x1f1ef, 0x1f1f5);

describe('cuisineCellLabel', () => {
  it('single cuisine label: the date, the catalog name and the count', () => {
    expect(cuisineCellLabel('2026-11-12', { count: 2, cuisines: 1 }, 'Italy', false)).toBe(
      'Nov 12, Italy, 2 uploads',
    );
    expect(cuisineCellLabel('2026-11-12', { count: 1, cuisines: 1 }, 'Italy', false)).toBe(
      'Nov 12, Italy, 1 upload',
    );
  });

  it('a mixed day says how many cuisines', () => {
    expect(cuisineCellLabel('2026-11-12', { count: 4, cuisines: 3 }, '', false)).toBe(
      'Nov 12, 3 cuisines, 4 uploads',
    );
  });

  it('adds ", today" on today', () => {
    expect(cuisineCellLabel('2026-11-12', { count: 1, cuisines: 1 }, 'Japan', true)).toBe(
      'Nov 12, Japan, 1 upload, today',
    );
    expect(cuisineCellLabel('2026-11-12', undefined, '', true)).toBe('Nov 12, no uploads, today');
  });

  it("keeps spec 14's label on a day without uploads", () => {
    expect(cuisineCellLabel('2026-11-12', undefined, '', false)).toBe('Nov 12, no uploads');
  });
});

describe('buildCuisineView', () => {
  const view = buildCuisineView(cuisineDaysJson(), CUISINES_WITH_NEUTRAL);

  it('one country cuisine shows its flag', () => {
    expect(view.cells['2026-11-03']).toEqual({
      label: 'Nov 3, Italy, 1 upload',
      glyph: { kind: 'flag', flag: ITALY_FLAG },
    });
    expect(view.cells['2026-11-12']).toEqual({
      label: 'Nov 12, Japan, 3 uploads, today',
      glyph: { kind: 'flag', flag: JAPAN_FLAG },
    });
  });

  it('one neutral cuisine shows its icon', () => {
    expect(view.cells['2026-11-10']).toEqual({
      label: 'Nov 10, Street food, 2 uploads',
      glyph: { kind: 'icon', icon: 'fast-food-outline' },
    });
  });

  it('more than one cuisine shows the globe', () => {
    expect(view.cells['2026-11-11']).toEqual({
      label: 'Nov 11, 3 cuisines, 4 uploads',
      glyph: { kind: 'globe' },
    });
  });

  it('a neutral plus a country cuisine (2 cuisines) shows the globe', () => {
    const mixed = buildCuisineView(
      cuisineDaysJson({ days: [{ date: '2026-11-12', count: 2, cuisines: 2, cuisine: null }] }),
      CUISINES_WITH_NEUTRAL,
    );
    expect(mixed.cells['2026-11-12']?.glyph).toEqual({ kind: 'globe' });
    expect(mixed.cells['2026-11-12']?.label).toBe('Nov 12, 2 cuisines, 2 uploads, today');
  });

  it('a code missing from the catalog speaks "Unknown cuisine" with the fallback icon', () => {
    const unknown = buildCuisineView(
      cuisineDaysJson({ days: [{ date: '2026-11-05', count: 1, cuisines: 1, cuisine: 'ZZ' }] }),
      CUISINES_WITH_NEUTRAL,
    );
    expect(unknown.cells['2026-11-05']).toEqual({
      label: 'Nov 5, Unknown cuisine, 1 upload',
      glyph: { kind: 'icon', icon: FALLBACK_CUISINE_ICON },
    });
  });

  it('has a glyph-free cell for every day from `from` to today', () => {
    const json = cuisineDaysJson();
    expect(Object.keys(view.cells)[0]).toBe(json.from);
    expect(Object.keys(view.cells).at(-1)).toBe('2026-11-12');
    expect(view.cells['2026-11-04']).toEqual({ label: 'Nov 4, no uploads', glyph: null });
    expect(view.cells['2026-11-13']).toBeUndefined();
  });

  it('lists the days with uploads newest first, with the cell labels, and totals them', () => {
    expect(view.rows).toEqual([
      { date: '2026-11-12', label: 'Nov 12, Japan, 3 uploads, today' },
      { date: '2026-11-11', label: 'Nov 11, 3 cuisines, 4 uploads' },
      { date: '2026-11-10', label: 'Nov 10, Street food, 2 uploads' },
      { date: '2026-11-03', label: 'Nov 3, Italy, 1 upload' },
    ]);
    expect(view.total).toBe(10);
  });
});

describe('the Cuisine view texts', () => {
  it('cuisineSummaryLabel', () => {
    expect(cuisineSummaryLabel(17, 23)).toBe('Cuisines, last 17 weeks, 23 uploads');
    expect(cuisineSummaryLabel(53, 1)).toBe('Cuisines, last 53 weeks, 1 upload');
  });

  it('the legend text and its spoken sentence', () => {
    expect(CUISINE_LEGEND).toEqual({
      one: 'One cuisine: its flag or icon',
      more: 'More than one',
      spoken: 'A flag or icon shows a day with one cuisine; a globe shows a day with more than one',
    });
  });

  it('the globe and the separator are the intended code points', () => {
    expect(GLOBE).toBe(String.fromCodePoint(0x1f30d));
    expect(LEGEND_SEPARATOR).toBe(String.fromCodePoint(0xb7));
  });
});

describe('parseActivityView', () => {
  it.each([
    ['cuisine', 'cuisine'],
    ['activity', 'activity'],
    ['bogus', 'activity'],
    ['Cuisine', 'activity'],
    [['cuisine'], 'activity'],
    [undefined, 'activity'],
  ])('%p opens %s', (param, expected) => {
    expect(parseActivityView(param)).toBe(expected);
  });
});
