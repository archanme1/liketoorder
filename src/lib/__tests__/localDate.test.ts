import {
  addDays,
  compareDates,
  dayOfWeek,
  daysBetween,
  formatShortDate,
  formatShortMonth,
} from '../localDate';

// Date-only strings: every result is a calendar day, whatever the zone jest runs in.

describe('addDays', () => {
  it('adds and subtracts days', () => {
    expect(addDays('2026-11-12', 1)).toBe('2026-11-13');
    expect(addDays('2026-11-12', -12)).toBe('2026-10-31');
    expect(addDays('2026-11-12', 0)).toBe('2026-11-12');
  });

  it('crosses a month end and a year end', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('knows leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('steps one day at a time across the 2025 America/Toronto clock changes', () => {
    // 23- and 25-hour days in Toronto; a date has no hours, so nothing is skipped or repeated.
    expect(addDays('2025-03-08', 1)).toBe('2025-03-09');
    expect(addDays('2025-03-09', 1)).toBe('2025-03-10');
    expect(addDays('2025-11-01', 1)).toBe('2025-11-02');
    expect(addDays('2025-11-02', 1)).toBe('2025-11-03');
  });

  it('refuses a value that is not a date', () => {
    expect(() => addDays('2026-11-12T00:00:00Z', 1)).toThrow();
  });
});

describe('dayOfWeek', () => {
  it('is 0 for Sunday to 6 for Saturday', () => {
    expect(dayOfWeek('2026-11-08')).toBe(0);
    expect(dayOfWeek('2026-11-12')).toBe(4);
    expect(dayOfWeek('2026-11-14')).toBe(6);
  });
});

describe('compareDates and daysBetween', () => {
  it('orders dates', () => {
    expect(compareDates('2026-11-12', '2026-11-13')).toBe(-1);
    expect(compareDates('2026-11-13', '2026-11-12')).toBe(1);
    expect(compareDates('2026-11-12', '2026-11-12')).toBe(0);
  });

  it('counts whole days, also across a clock change', () => {
    expect(daysBetween('2026-11-01', '2026-11-12')).toBe(11);
    expect(daysBetween('2025-03-08', '2025-03-10')).toBe(2);
    expect(daysBetween('2025-11-01', '2025-11-03')).toBe(2);
  });
});

describe('formatShortDate', () => {
  it('gives "Nov 12"', () => {
    expect(formatShortDate('2026-11-12', 'en-US')).toBe('Nov 12');
    expect(formatShortDate('2027-01-01', 'en-US')).toBe('Jan 1');
  });

  it('gives the month alone', () => {
    expect(formatShortMonth('2026-11-12', 'en-US')).toBe('Nov');
  });
});
