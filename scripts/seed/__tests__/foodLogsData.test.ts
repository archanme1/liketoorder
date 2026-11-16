import {
  dateInZone,
  FOOD_LOG_ACCOUNTS,
  localTimeToInstant,
  MAX_PER_DATE,
  parseTimeZone,
  planFoodLogs,
  SEED_CUISINES,
  uploadsOn,
} from '../foodLogsData';
import { isSeedEmail } from '../safety';

const NOW = new Date('2026-11-16T15:00:00Z');
const ZONES = ['UTC', 'America/Toronto', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];

function shift(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

function countsByDate(zone: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const plan of planFoodLogs(NOW, zone)) {
    counts.set(plan.localDate, (counts.get(plan.localDate) ?? 0) + 1);
  }
  return counts;
}

/** Runs of consecutive dates with uploads, as lengths keyed by their last date. */
function runs(counts: Map<string, number>): Map<string, number> {
  const dates = [...counts.keys()].sort();
  const result = new Map<string, number>();
  let length = 0;
  dates.forEach((date, i) => {
    length = i > 0 && shift(dates[i - 1], 1) === date ? length + 1 : 1;
    if (i === dates.length - 1 || shift(date, 1) !== dates[i + 1]) result.set(date, length);
  });
  return result;
}

describe('planFoodLogs', () => {
  it.each(ZONES)(
    'keeps every created_at within the UTC date +/-1 and not after now (%s)',
    (zone) => {
      for (const plan of planFoodLogs(NOW, zone)) {
        const utcDate = plan.createdAt.slice(0, 10);
        expect(plan.localDate >= shift(utcDate, -1) && plan.localDate <= shift(utcDate, 1)).toBe(
          true,
        );
        expect(new Date(plan.createdAt).getTime()).toBeLessThanOrEqual(NOW.getTime());
        // The planned local day is the day of created_at in that zone.
        expect(dateInZone(new Date(plan.createdAt), zone)).toBe(plan.localDate);
      }
    },
  );

  it.each(ZONES)('never plans more than 6 uploads on one date (%s)', (zone) => {
    expect(Math.max(...countsByDate(zone).values())).toBeLessThanOrEqual(MAX_PER_DATE);
  });

  it('plans a day with 4 or more uploads, and mixed cuisines on busy days', () => {
    const plans = planFoodLogs(NOW, 'UTC');
    const counts = countsByDate('UTC');
    const busy = [...counts].filter(([, count]) => count >= 4).map(([date]) => date);
    expect(busy.length).toBeGreaterThan(0);
    for (const date of busy) {
      const cuisines = new Set(plans.filter((p) => p.localDate === date).map((p) => p.cuisineCode));
      expect(cuisines.size).toBeGreaterThan(1);
    }
  });

  it('plans a run ending yesterday and nothing today, so the current streak shows', () => {
    const counts = countsByDate('UTC');
    const today = dateInZone(NOW, 'UTC');
    expect(counts.has(today)).toBe(false);
    expect(runs(counts).get(shift(today, -1))).toBe(6);
  });

  it('plans gaps, and a longest run longer than the current one', () => {
    const counts = countsByDate('UTC');
    const today = dateInZone(NOW, 'UTC');
    const gaps = Array.from({ length: 182 }, (_, i) => shift(today, -(i + 1))).filter(
      (date) => !counts.has(date),
    );
    expect(gaps.length).toBeGreaterThan(20);
    expect(Math.max(...runs(counts).values())).toBeGreaterThanOrEqual(13);
  });

  it('plans about 6 months, some private and some without a description', () => {
    const plans = planFoodLogs(NOW, 'UTC');
    const today = dateInZone(NOW, 'UTC');
    const dates = plans.map((p) => p.localDate).sort();
    expect(dates[0]).toBe(shift(today, -182));
    expect(plans.some((p) => !p.isPublic)).toBe(true);
    expect(plans.some((p) => p.isPublic)).toBe(true);
    expect(plans.some((p) => p.description === null)).toBe(true);
  });

  it('uses only catalog cuisine codes, the neutral ones included', () => {
    const used = new Set(planFoodLogs(NOW, 'UTC').map((p) => p.cuisineCode));
    for (const code of used) expect(SEED_CUISINES).toContain(code);
    expect(used).toEqual(new Set(SEED_CUISINES));
  });

  it('is deterministic', () => {
    expect(planFoodLogs(NOW, 'Asia/Tokyo')).toEqual(planFoodLogs(NOW, 'Asia/Tokyo'));
  });

  it('never plans more than the cap on any day offset', () => {
    for (let offset = 0; offset <= 400; offset++) {
      expect(uploadsOn(offset)).toBeLessThanOrEqual(MAX_PER_DATE);
    }
  });
});

describe('localTimeToInstant', () => {
  it('turns a local hour into the right instant, also on clock-change days', () => {
    expect(localTimeToInstant('2026-11-12', 23, 'UTC').toISOString()).toBe(
      '2026-11-12T23:00:00.000Z',
    );
    // Toronto: EDT (-4) before Sun 2025-11-02, EST (-5) after; EST before Sun 2025-03-09.
    expect(localTimeToInstant('2025-11-01', 20, 'America/Toronto').toISOString()).toBe(
      '2025-11-02T00:00:00.000Z',
    );
    expect(localTimeToInstant('2025-11-02', 20, 'America/Toronto').toISOString()).toBe(
      '2025-11-03T01:00:00.000Z',
    );
    expect(localTimeToInstant('2025-03-09', 8, 'America/Toronto').toISOString()).toBe(
      '2025-03-09T12:00:00.000Z',
    );
  });
});

describe('parseTimeZone', () => {
  it('takes --tz, else the fallback, and refuses an unknown zone', () => {
    expect(parseTimeZone(['--tz', 'Asia/Tokyo'], 'UTC')).toBe('Asia/Tokyo');
    expect(parseTimeZone([], 'Europe/Paris')).toBe('Europe/Paris');
    expect(() => parseTimeZone(['--tz', 'Mars/Olympus'], 'UTC')).toThrow();
    expect(() => parseTimeZone(['--tz'], 'UTC')).toThrow();
  });
});

describe('FOOD_LOG_ACCOUNTS', () => {
  it('uses only seed-*@example.com accounts with valid usernames', () => {
    expect(FOOD_LOG_ACCOUNTS.map((a) => a.email)).toEqual([
      'seed-foodlog@example.com',
      'seed-foodlog-empty@example.com',
    ]);
    for (const account of FOOD_LOG_ACCOUNTS) {
      expect(isSeedEmail(account.email)).toBe(true);
      expect(account.username).toMatch(/^[a-z0-9_]{3,20}$/);
    }
    expect(FOOD_LOG_ACCOUNTS.filter((a) => a.withLogs)).toHaveLength(1);
  });
});
