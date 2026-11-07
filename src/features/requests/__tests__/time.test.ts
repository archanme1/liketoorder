import {
  buildPickupDays,
  earliestPickup,
  formatDateTime,
  formatTime,
  latestPickup,
  localDateKey,
} from '../time';

// Auckland is UTC+13 in November (daylight time), so its calendar day starts at 11:00 UTC the day
// before. The tests pass the zone in; nothing here depends on the machine's own zone.
const AUCKLAND = { timeZone: 'Pacific/Auckland', locale: 'en-US' };

describe('localDateKey', () => {
  it('uses the zone, not UTC', () => {
    const instant = new Date('2026-11-07T20:00:00Z'); // Nov 8, 09:00 in Auckland
    expect(localDateKey(instant, 'UTC')).toBe('2026-11-07');
    expect(localDateKey(instant, 'Pacific/Auckland')).toBe('2026-11-08');
    expect(localDateKey(instant, 'America/Toronto')).toBe('2026-11-07');
  });
});

describe('formatting', () => {
  it('shows a UTC timestamp in the chosen zone', () => {
    expect(formatDateTime('2026-11-07T20:00:00Z', AUCKLAND)).toBe('Sun, Nov 8, 9:00 AM');
    expect(formatDateTime('2026-11-07T20:00:00Z', { timeZone: 'UTC', locale: 'en-US' })).toBe(
      'Sat, Nov 7, 8:00 PM',
    );
    expect(formatTime(new Date('2026-11-07T20:00:00Z'), AUCKLAND)).toBe('9:00 AM');
  });
});

describe('earliest and latest', () => {
  const now = new Date('2026-11-07T10:07:00Z');

  it('earliest is 15+ minutes ahead, rounded up to a quarter hour', () => {
    const earliest = earliestPickup(now);
    expect(earliest.toISOString()).toBe('2026-11-07T10:30:00.000Z');
    expect(earliest.getTime() - now.getTime()).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it('is a full quarter hour on an exact boundary too', () => {
    const exact = new Date('2026-11-07T10:00:00Z');
    expect(earliestPickup(exact).toISOString()).toBe('2026-11-07T10:30:00.000Z');
  });

  it('latest is 7 days ahead at most', () => {
    expect(latestPickup(now).getTime()).toBeLessThanOrEqual(now.getTime() + 7 * 86_400_000);
  });
});

describe('buildPickupDays', () => {
  it('groups slots by the local date in the zone', () => {
    // 12:00 UTC on Nov 7 is 01:00 on Nov 8 in Auckland: the first day is Nov 8, and a UTC
    // grouping would call it Nov 7.
    const days = buildPickupDays(new Date('2026-11-07T12:00:00Z'), AUCKLAND);
    expect(days[0].key).toBe('2026-11-08');
    expect(days[0].label).toBe('Today');
    expect(days[0].slots).toHaveLength(90); // 1:30 AM to 11:45 PM
    expect(formatTime(days[0].slots[0], AUCKLAND)).toBe('1:30 AM');
    expect(formatTime(days[0].slots[89], AUCKLAND)).toBe('11:45 PM');
    expect(days[1].key).toBe('2026-11-09');
    expect(days[1].label).toBe('Mon, Nov 9');
    expect(days[1].slots).toHaveLength(96);
  });

  it('the same instant lands on a different day in a different zone', () => {
    const now = new Date('2026-11-07T12:00:00Z');
    const toronto = buildPickupDays(now, { timeZone: 'America/Toronto', locale: 'en-US' });
    expect(toronto[0].key).toBe('2026-11-07'); // 07:00 in Toronto
    expect(toronto[0].label).toBe('Today');
  });

  it('every slot is a quarter hour on the local clock', () => {
    const days = buildPickupDays(new Date('2026-11-07T12:00:00Z'), AUCKLAND);
    for (const day of days) {
      for (const slot of day.slots) {
        const minutes = Number(
          new Intl.DateTimeFormat('en-US', {
            timeZone: 'Pacific/Auckland',
            minute: 'numeric',
          }).format(slot),
        );
        expect(minutes % 15).toBe(0);
      }
    }
  });

  it('offers about 7 days of times, none sooner than 15 minutes', () => {
    const now = new Date('2026-11-07T10:07:00Z');
    const days = buildPickupDays(now, AUCKLAND);
    const slots = days.flatMap((day) => day.slots);
    expect(slots[0].getTime() - now.getTime()).toBeGreaterThanOrEqual(15 * 60_000);
    expect(slots[slots.length - 1].getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
    expect(slots.length).toBeGreaterThan(7 * 96 - 4);
  });

  it('handles the daylight-saving change: Auckland springs forward on 27 September 2026', () => {
    // 02:00 -> 03:00 that night, so the local day has 23 hours and no 2:xx AM slots.
    const days = buildPickupDays(new Date('2026-09-26T04:00:00Z'), AUCKLAND);
    const dst = days.find((day) => day.key === '2026-09-27');
    expect(dst).toBeDefined();
    expect(dst?.slots).toHaveLength(92);
    const labels = dst?.slots.map((slot) => formatTime(slot, AUCKLAND)) ?? [];
    expect(labels).not.toContain('2:00 AM');
    expect(labels).not.toContain('2:30 AM');
    expect(labels).toContain('1:45 AM');
    expect(labels).toContain('3:00 AM');
    // Local dates stay in order, one group per date.
    const keys = days.map((day) => day.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(keys);
  });

  it('handles the change back: Auckland falls back on 5 April 2026', () => {
    const days = buildPickupDays(new Date('2026-04-04T04:00:00Z'), AUCKLAND);
    const dst = days.find((day) => day.key === '2026-04-05');
    expect(dst?.slots).toHaveLength(100); // a 25-hour day
  });
});
