import {
  clampToWindow,
  combineDateAndTime,
  earliestPickup,
  formatDateTime,
  formatTime,
  latestPickup,
  localDateKey,
  snapToQuarter,
  wallTimeToInstant,
} from '../time';

// Auckland is UTC+13 in November (daylight time), so its calendar day starts at 11:00 UTC the day
// before. The tests pass the zone in; nothing here depends on the machine's own zone.
const AUCKLAND = { timeZone: 'Pacific/Auckland', locale: 'en-US' };
const HOUR = 3_600_000;
const iso = (date: Date) => date.toISOString();

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
    expect(iso(earliest)).toBe('2026-11-07T10:30:00.000Z');
    expect(earliest.getTime() - now.getTime()).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it('is a full quarter hour on an exact boundary too', () => {
    expect(iso(earliestPickup(new Date('2026-11-07T10:00:00Z')))).toBe('2026-11-07T10:30:00.000Z');
  });

  it('latest is 7 days ahead at most', () => {
    expect(latestPickup(now).getTime()).toBeLessThanOrEqual(now.getTime() + 7 * 24 * HOUR);
  });

  it('the window is 7 days of elapsed time, even across a daylight-saving change', () => {
    // Auckland springs forward on 27 September 2026: seven days from the 24th spans the change.
    const before = new Date('2026-09-24T04:00:00Z');
    const latest = latestPickup(before);
    expect(latest.getTime() - before.getTime()).toBeLessThanOrEqual(7 * 24 * HOUR);
    expect(latest.getTime() - before.getTime()).toBeGreaterThan(7 * 24 * HOUR - 15 * 60_000);
    // On the Auckland clock that is one hour later than the same time a week on.
    expect(formatTime(before, AUCKLAND)).toBe('4:00 PM');
    expect(formatTime(latest, AUCKLAND)).toBe('5:00 PM');
  });
});

describe('snapToQuarter', () => {
  it('rounds to the nearest quarter hour', () => {
    expect(iso(snapToQuarter(new Date('2026-11-07T10:07:00Z')))).toBe('2026-11-07T10:00:00.000Z');
    expect(iso(snapToQuarter(new Date('2026-11-07T10:08:00Z')))).toBe('2026-11-07T10:15:00.000Z');
    expect(iso(snapToQuarter(new Date('2026-11-07T10:15:00Z')))).toBe('2026-11-07T10:15:00.000Z');
  });

  it.each([
    ['Pacific/Auckland', '2026-11-07T10:07:40Z'],
    ['Asia/Kathmandu', '2026-11-07T10:07:40Z'], // UTC+5:45
    ['Australia/Adelaide', '2026-01-07T10:07:40Z'], // UTC+10:30 in summer
    ['Australia/Lord_Howe', '2026-01-07T10:22:10Z'], // UTC+11 (30-minute daylight saving)
    ['America/St_Johns', '2026-07-07T10:51:00Z'], // UTC-2:30
    ['America/Toronto', '2026-11-07T10:51:00Z'],
  ])('lands on a quarter hour of the LOCAL clock in %s', (timeZone, at) => {
    const minutes = Number(
      new Intl.DateTimeFormat('en-US', { timeZone, minute: 'numeric' }).format(
        snapToQuarter(new Date(at)),
      ),
    );
    expect(minutes % 15).toBe(0);
  });
});

describe('clampToWindow', () => {
  const now = new Date('2026-11-07T12:00:00Z'); // 01:00 on 8 November in Auckland
  const earliest = earliestPickup(now); // 12:30Z
  const latest = latestPickup(now);

  it('keeps a time inside the window, snapped to a quarter hour', () => {
    const result = clampToWindow(new Date('2026-11-07T18:07:00Z'), now);
    expect(iso(result.value)).toBe('2026-11-07T18:00:00.000Z');
    expect(result.problem).toBeNull();
  });

  it('too soon: the earliest allowed time, and which side it was', () => {
    const result = clampToWindow(new Date('2026-11-07T12:15:00Z'), now);
    expect(iso(result.value)).toBe(iso(earliest));
    expect(result.problem).toBe('too_soon');
  });

  it('exactly the earliest and the latest are fine', () => {
    expect(clampToWindow(earliest, now)).toEqual({ value: earliest, problem: null });
    expect(clampToWindow(latest, now)).toEqual({ value: latest, problem: null });
  });

  it('too far: the latest allowed time', () => {
    const result = clampToWindow(new Date(latest.getTime() + 2 * HOUR), now);
    expect(iso(result.value)).toBe(iso(latest));
    expect(result.problem).toBe('too_far');
  });

  it('a time a hair under the earliest snaps up into the window, not out of it', () => {
    const result = clampToWindow(new Date(earliest.getTime() - 5 * 60_000), now);
    expect(result.problem).toBeNull(); // 5 minutes under snaps to the earliest
    expect(iso(result.value)).toBe(iso(earliest));
  });
});

describe('wallTimeToInstant', () => {
  it('Auckland: an ordinary time', () => {
    const instant = wallTimeToInstant(
      { year: 2026, month: 11, day: 8, hour: 18, minute: 0 },
      'Pacific/Auckland',
    );
    expect(iso(instant)).toBe('2026-11-08T05:00:00.000Z'); // NZDT is UTC+13
  });

  it('Auckland: a time that never happens (clocks jump 02:00 to 03:00) moves ahead by the gap', () => {
    const instant = wallTimeToInstant(
      { year: 2026, month: 9, day: 27, hour: 2, minute: 30 },
      'Pacific/Auckland',
    );
    expect(iso(instant)).toBe('2026-09-26T14:30:00.000Z');
    expect(formatTime(instant, AUCKLAND)).toBe('3:30 AM');
  });

  it('Auckland: a time that happens twice (clocks go back 03:00 to 02:00) is the first one', () => {
    const instant = wallTimeToInstant(
      { year: 2026, month: 4, day: 5, hour: 2, minute: 30 },
      'Pacific/Auckland',
    );
    expect(iso(instant)).toBe('2026-04-04T13:30:00.000Z'); // still daylight time, UTC+13
  });

  it('Toronto: the same two cases the other way round', () => {
    expect(
      iso(
        wallTimeToInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/Toronto'),
      ),
    ).toBe('2026-03-08T07:30:00.000Z'); // 02:30 does not exist; 03:30 EDT
    expect(
      iso(
        wallTimeToInstant(
          { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
          'America/Toronto',
        ),
      ),
    ).toBe('2026-11-01T05:30:00.000Z'); // 01:30 happens twice; the EDT one
  });

  it('Kathmandu (UTC+5:45) and UTC', () => {
    expect(
      iso(
        wallTimeToInstant(
          { year: 2026, month: 11, day: 8, hour: 18, minute: 15 },
          'Asia/Kathmandu',
        ),
      ),
    ).toBe('2026-11-08T12:30:00.000Z');
    expect(
      iso(wallTimeToInstant({ year: 2026, month: 11, day: 8, hour: 18, minute: 15 }, 'UTC')),
    ).toBe('2026-11-08T18:15:00.000Z');
  });
});

describe('combineDateAndTime', () => {
  it('takes the calendar day from one instant and the wall-clock time from the other', () => {
    // 01:00 on 8 November in Auckland (still 7 November in UTC) and 18:00 on 7 November there.
    const day = new Date('2026-11-07T12:00:00Z');
    const time = new Date('2026-11-07T05:00:00Z');
    const combined = combineDateAndTime(day, time, 'Pacific/Auckland');
    expect(iso(combined)).toBe('2026-11-08T05:00:00.000Z'); // 8 November, 18:00 in Auckland
    expect(formatDateTime(combined, AUCKLAND)).toBe('Sun, Nov 8, 6:00 PM');
    // UTC would have said 7 November 05:00Z + 12:00 = a different day.
    expect(localDateKey(combined, 'Pacific/Auckland')).toBe('2026-11-08');
  });

  it('keeps the wall-clock time across a daylight-saving change (the instant moves by 23 hours)', () => {
    // 18:00 on 26 September (UTC+12) moved to 27 September (UTC+13) is still 18:00 on the clock.
    const time = wallTimeToInstant(
      { year: 2026, month: 9, day: 26, hour: 18, minute: 0 },
      'Pacific/Auckland',
    );
    const day = wallTimeToInstant(
      { year: 2026, month: 9, day: 27, hour: 9, minute: 0 },
      'Pacific/Auckland',
    );
    const combined = combineDateAndTime(day, time, 'Pacific/Auckland');
    expect(formatDateTime(combined, AUCKLAND)).toBe('Sun, Sep 27, 6:00 PM');
    expect(combined.getTime() - time.getTime()).toBe(23 * HOUR);
  });

  it('a wall time that does not exist on the chosen day moves ahead (02:30 on the spring-forward day)', () => {
    const time = wallTimeToInstant(
      { year: 2026, month: 9, day: 26, hour: 2, minute: 30 },
      'Pacific/Auckland',
    );
    const day = wallTimeToInstant(
      { year: 2026, month: 9, day: 27, hour: 12, minute: 0 },
      'Pacific/Auckland',
    );
    expect(formatDateTime(combineDateAndTime(day, time, 'Pacific/Auckland'), AUCKLAND)).toBe(
      'Sun, Sep 27, 3:30 AM',
    );
  });

  it('works in Kathmandu and in Toronto, and with the same instant for both', () => {
    const kathmandu = { timeZone: 'Asia/Kathmandu', locale: 'en-US' };
    const day = new Date('2026-11-08T05:00:00Z'); // 10:45 on 8 November there
    const time = new Date('2026-11-07T13:00:00Z'); // 18:45 on 7 November there
    expect(formatDateTime(combineDateAndTime(day, time, 'Asia/Kathmandu'), kathmandu)).toBe(
      'Sun, Nov 8, 6:45 PM',
    );
    const same = new Date('2026-11-08T17:00:00Z');
    expect(iso(combineDateAndTime(same, same, 'America/Toronto'))).toBe(iso(same));
  });
});
