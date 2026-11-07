import {
  CUSTOMER_EMAIL,
  expiryFor,
  MAX_EXTRA,
  parseExtra,
  planExtraRequests,
  planRequests,
  snapshotItems,
} from '../requestsData';
import { HOMEMADE_COOKS } from '../homemadeData';
import { RESTAURANTS } from '../restaurantData';
import { isSeedEmail } from '../safety';

const NOW = new Date('2026-11-08T17:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('planRequests', () => {
  const plan = planRequests(NOW);

  it('covers every status', () => {
    const statuses = new Set(plan.map((row) => row.status));
    for (const status of [
      'pending',
      'accepted',
      'declined',
      'expired',
      'cancelled',
      'completed',
      'no_show',
    ]) {
      expect(statuses).toContain(status);
    }
  });

  it('has exactly one pending row that expires about 2 minutes after the seed runs', () => {
    const expiring = plan.filter(
      (row) =>
        row.status === 'pending' &&
        row.expiresAt.getTime() > NOW.getTime() &&
        row.expiresAt.getTime() - NOW.getTime() <= 3 * MIN,
    );
    expect(expiring).toHaveLength(1);
    expect(expiring[0].expiresAt.getTime() - NOW.getTime()).toBe(2 * MIN);
  });

  it('has a longer-lived pending row to try Cancel on', () => {
    const fresh = plan.find((row) => row.key === 'pending-cancel-me');
    expect(fresh?.status).toBe('pending');
    expect((fresh?.expiresAt.getTime() ?? 0) - NOW.getTime()).toBe(30 * MIN);
  });

  it('has an ACCEPTED homemade request with the pickup near now, inside the 24-hour window', () => {
    const accepted = plan.find((row) => row.status === 'accepted');
    expect(accepted?.target.kind).toBe('homemade');
    const pickup = accepted?.pickupAt.getTime() ?? 0;
    expect(pickup).toBeGreaterThan(NOW.getTime());
    expect(pickup - NOW.getTime()).toBeLessThanOrEqual(HOUR);
    expect(accepted?.respondedAt).not.toBeNull();
  });

  it('has a declined homemade request', () => {
    expect(plan.find((row) => row.status === 'declined')?.target.kind).toBe('homemade');
  });

  it('has a completed homemade request still inside the 24-hour window (address visible)', () => {
    const done = plan.find((row) => row.key === 'completed-homemade');
    expect(done?.status).toBe('completed');
    expect(NOW.getTime() - (done?.pickupAt.getTime() ?? 0)).toBeLessThan(24 * HOUR);
  });

  it('follows the table rules: expiry is the earlier of created + 30 min and pickup', () => {
    for (const row of plan) {
      expect(row.expiresAt.getTime()).toBe(expiryFor(row.createdAt, row.pickupAt).getTime());
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(row.pickupAt.getTime());
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it('only a pending row expires in the future, and answered rows have a response time', () => {
    for (const row of plan) {
      if (row.status !== 'pending')
        expect(row.expiresAt.getTime()).toBeLessThanOrEqual(NOW.getTime() + 30 * MIN);
      if (['accepted', 'declined', 'completed', 'no_show'].includes(row.status)) {
        expect(row.respondedAt).not.toBeNull();
      }
      if (['pending', 'cancelled', 'expired'].includes(row.status)) {
        expect(row.respondedAt).toBeNull();
      }
    }
  });

  it('only targets demo (seed) accounts', () => {
    for (const row of plan)
      expect(row.target.ownerUsername).toMatch(/^seed_(rest_\d{3}|cook_\d+)$/);
  });

  it('uses unique keys and a seed-only customer account', () => {
    expect(new Set(plan.map((row) => row.key)).size).toBe(plan.length);
    expect(isSeedEmail(CUSTOMER_EMAIL)).toBe(true);
  });

  it('every row has items or text to fill in, and text stays within the limits', () => {
    for (const row of plan) {
      expect(row.itemCount > 0 || row.orderText !== null).toBe(true);
      expect(row.orderText?.length ?? 1).toBeLessThanOrEqual(500);
      expect(row.note?.length ?? 1).toBeLessThanOrEqual(300);
    }
  });

  it('is relative to the run time', () => {
    const later = planRequests(new Date(NOW.getTime() + HOUR));
    expect(later[0].pickupAt.getTime() - plan[0].pickupAt.getTime()).toBe(HOUR);
  });
});

describe('snapshotItems', () => {
  const menu = [
    { id: 'a', name: 'Pasta', price_minor: 1800 },
    { id: 'b', name: 'Cake', price_minor: null },
    { id: 'c', name: 'Soup', price_minor: 500 },
  ];

  it('copies the first lines with the server-style fields', () => {
    expect(snapshotItems(menu, 2)).toEqual([
      { item_id: 'a', name: 'Pasta', unit_price_minor: 1800, quantity: 2 },
      { item_id: 'b', name: 'Cake', unit_price_minor: null, quantity: 1 },
    ]);
  });

  it('is null for no items (the row then needs written text)', () => {
    expect(snapshotItems(menu, 0)).toBeNull();
    expect(snapshotItems([], 2)).toBeNull();
  });
});

describe('parseExtra', () => {
  it('is null without the flag', () => {
    expect(parseExtra([])).toBeNull();
    expect(parseExtra(['--other'])).toBeNull();
  });

  it('defaults to 120, or takes a number', () => {
    expect(parseExtra(['--extra'])).toBe(120);
    expect(parseExtra(['--extra', '--other'])).toBe(120);
    expect(parseExtra(['--extra', '30'])).toBe(30);
  });

  it.each([['abc'], ['-5'], ['0'], ['1.5'], [String(MAX_EXTRA + 1)]])('refuses %p', (value) => {
    expect(() => parseExtra(['--extra', value])).toThrow();
  });
});

describe('planExtraRequests', () => {
  const extra = planExtraRequests(NOW, 120);

  it('makes the number asked for, with unique keys', () => {
    expect(extra).toHaveLength(120);
    expect(new Set(extra.map((row) => row.key)).size).toBe(120);
  });

  it('never ties two created_at values (no ties at a page boundary)', () => {
    const times = extra.map((row) => row.createdAt.getTime());
    expect(new Set(times).size).toBe(120);
    // Newest first in plan order, and all older than the main plan.
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const oldestMain = Math.min(...planRequests(NOW).map((row) => row.createdAt.getTime()));
    expect(Math.max(...times)).toBeLessThan(oldestMain);
  });

  it('has no pending rows, and follows the table rules', () => {
    for (const row of extra) {
      expect(row.status).not.toBe('pending');
      expect(row.expiresAt.getTime()).toBe(expiryFor(row.createdAt, row.pickupAt).getTime());
      expect(row.itemCount > 0 || row.orderText !== null).toBe(true);
      expect(row.orderText?.length ?? 1).toBeLessThanOrEqual(500);
    }
  });

  it('answered rows have a response time, the others none', () => {
    for (const row of extra) {
      const answered = ['completed', 'declined', 'no_show'].includes(row.status);
      expect(row.respondedAt === null).toBe(!answered);
    }
  });

  it('the demo restaurants and cooks it targets exist in the restaurants seed', () => {
    const numbers = (kind: string, pattern: RegExp) =>
      extra
        .filter((row) => row.target.kind === kind)
        .map((row) => Number(pattern.exec(row.target.ownerUsername)?.[1]));
    expect(Math.max(...numbers('restaurant', /_(\d+)$/))).toBeLessThanOrEqual(RESTAURANTS.length);
    expect(Math.max(...numbers('homemade', /_(\d+)$/))).toBeLessThanOrEqual(HOMEMADE_COOKS.length);
  });

  it('only targets demo accounts the restaurants seed creates, and mixes restaurants and cooks', () => {
    for (const row of extra) {
      expect(row.target.ownerUsername).toMatch(
        /^seed_(rest_(00[7-9]|0[1-3]\d|040)|cook_([4-9]|1[0-3]))$/,
      );
    }
    expect(new Set(extra.map((row) => row.target.kind))).toEqual(
      new Set(['restaurant', 'homemade']),
    );
  });
});
