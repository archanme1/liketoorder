import {
  TABLE_WINDOW,
  clampToWindow,
  earliestTable,
  formatDateTimeWithZone,
  latestTable,
} from '../time';

// 2026-11-09 00:00 UTC is 7:00 pm on Nov 8 in Toronto (EST) and 1:00 pm on Nov 9 in Auckland (NZDT).
const TABLE_AT = '2026-11-09T00:00:00+00:00';

describe('formatDateTimeWithZone', () => {
  it('shows the zone name with the time, in the zone it was given', () => {
    expect(formatDateTimeWithZone(TABLE_AT, { timeZone: 'America/Toronto', locale: 'en-US' })).toBe(
      'Sun, Nov 8, 7:00 PM EST',
    );
  });

  it('renders the same instant in another zone with that zone and its own time', () => {
    const auckland = formatDateTimeWithZone(TABLE_AT, {
      timeZone: 'Pacific/Auckland',
      locale: 'en-US',
    });
    expect(auckland).toMatch(/^Mon, Nov 9, 1:00 PM /);
    expect(auckland).not.toMatch(/EST/);
  });

  it('shows daylight time as its own name (7:00 pm EDT in July)', () => {
    expect(
      formatDateTimeWithZone('2026-07-15T23:00:00+00:00', {
        timeZone: 'America/Toronto',
        locale: 'en-US',
      }),
    ).toBe('Wed, Jul 15, 7:00 PM EDT');
  });
});

describe('the table window (30 minutes to 30 days)', () => {
  const now = new Date('2026-11-08T17:00:00Z');

  it('offers the first quarter hour after 30 minutes plus a minute of slack', () => {
    expect(earliestTable(now).toISOString()).toBe('2026-11-08T17:45:00.000Z');
  });

  it('offers up to 30 days ahead, rounded down', () => {
    expect(latestTable(new Date('2026-11-08T17:07:00Z')).toISOString()).toBe(
      '2026-12-08T17:00:00.000Z',
    );
  });

  it('clamps a time that is too soon or too far to the nearest allowed one', () => {
    const soon = clampToWindow(new Date('2026-11-08T17:10:00Z'), now, TABLE_WINDOW);
    expect(soon.problem).toBe('too_soon');
    expect(soon.value.toISOString()).toBe('2026-11-08T17:45:00.000Z');
    const far = clampToWindow(new Date('2027-02-01T00:00:00Z'), now, TABLE_WINDOW);
    expect(far.problem).toBe('too_far');
    expect(clampToWindow(new Date('2026-11-09T00:00:00Z'), now, TABLE_WINDOW).problem).toBeNull();
  });
});
