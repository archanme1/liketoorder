import {
  CUSTOMER_EMAIL,
  expiryFor,
  MAX_EXTRA,
  needsAddressSnapshot,
  parseInboxExtra,
  planInboxExtra,
  planRequests,
  planSellerInbox,
  SEED_CUSTOMERS,
} from '../requestsData';
import { isSeedEmail } from '../safety';

const NOW = new Date('2026-11-08T17:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('SEED_CUSTOMERS', () => {
  it('keeps the original demo customer and adds three more', () => {
    expect(SEED_CUSTOMERS.map((c) => c.key)).toEqual(['demo', 'sam', 'priya', 'limit']);
    expect(SEED_CUSTOMERS[0].email).toBe(CUSTOMER_EMAIL);
  });

  it('every one is a seed-*@example.com account, so the seed may delete and re-create it', () => {
    for (const customer of SEED_CUSTOMERS) expect(isSeedEmail(customer.email)).toBe(true);
  });

  it('has unique emails, usernames and distinct names to read in the inbox', () => {
    for (const field of ['email', 'username', 'displayName'] as const) {
      expect(new Set(SEED_CUSTOMERS.map((c) => c[field])).size).toBe(SEED_CUSTOMERS.length);
    }
  });
});

describe('planSellerInbox', () => {
  const plan = planSellerInbox(NOW);
  const by = (key: string) => plan.find((row) => row.key === `inbox-${key}`);

  it('has a pending row to accept and a pending row to decline, with time to answer', () => {
    for (const key of ['accept-me', 'decline-me']) {
      const row = by(key);
      expect(row?.status).toBe('pending');
      expect(row!.expiresAt.getTime()).toBeGreaterThan(NOW.getTime() + 20 * MIN);
    }
  });

  it('has accepted rows whose pickup time has passed, to mark completed and no-show', () => {
    for (const key of ['complete-me', 'noshow-me']) {
      const row = by(key);
      expect(row?.status).toBe('accepted');
      expect(row!.pickupAt.getTime()).toBeLessThan(NOW.getTime());
      expect(row?.respondedAt).not.toBeNull();
    }
    expect(by('noshow-me')!.pickupAt.getTime()).toBeLessThan(by('complete-me')!.pickupAt.getTime());
  });

  it('has an accepted row that must still wait for its pickup time', () => {
    const row = by('accepted-later');
    expect(row?.status).toBe('accepted');
    expect(row!.pickupAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('has every final status for the All filter', () => {
    const statuses = new Set(plan.map((row) => row.status));
    for (const status of ['declined', 'cancelled', 'expired', 'completed', 'no_show']) {
      expect(statuses).toContain(status);
    }
  });

  it('has a homemade seller with a pending request (the address notice) and an accepted past-pickup one', () => {
    const homemade = plan.filter((row) => row.target.kind === 'homemade');
    expect(homemade.every((row) => row.target.ownerUsername === 'seed_cook_1')).toBe(true);
    expect(by('cook-accept-me')?.status).toBe('pending');
    const done = by('cook-complete-me');
    expect(done?.status).toBe('accepted');
    expect(done!.pickupAt.getTime()).toBeLessThan(NOW.getTime());
  });

  it('puts the restaurant rows on seed_rest_001', () => {
    for (const row of plan.filter((r) => r.target.kind === 'restaurant')) {
      expect(row.target.ownerUsername).toBe('seed_rest_001');
    }
  });

  it('uses the two new customers, each with a real key', () => {
    const keys = new Set(plan.map((row) => row.customer));
    expect(keys).toEqual(new Set(['sam', 'priya']));
    for (const key of keys) expect(SEED_CUSTOMERS.some((c) => c.key === key)).toBe(true);
  });

  it('follows the table rules: expiry is the earlier of created + 30 min and pickup, created is in the past', () => {
    for (const row of plan) {
      expect(row.expiresAt.getTime()).toBe(expiryFor(row.createdAt, row.pickupAt).getTime());
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(row.pickupAt.getTime());
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it('answered rows have a response time, the others do not', () => {
    for (const row of plan) {
      if (['accepted', 'declined', 'completed', 'no_show'].includes(row.status)) {
        expect(row.respondedAt).not.toBeNull();
      } else {
        expect(row.respondedAt).toBeNull();
      }
    }
  });

  it('every row has items or text, within the limits', () => {
    for (const row of plan) {
      expect(row.itemCount > 0 || row.orderText !== null).toBe(true);
      expect(row.orderText?.length ?? 1).toBeLessThanOrEqual(500);
      expect(row.note?.length ?? 1).toBeLessThanOrEqual(300);
    }
  });

  it('has unique keys that do not clash with the main plan', () => {
    const all = [...planRequests(NOW), ...plan, ...planInboxExtra(NOW, 60)];
    expect(new Set(all.map((row) => row.key)).size).toBe(all.length);
  });

  it('only targets demo (seed) accounts', () => {
    for (const row of plan) {
      expect(row.target.ownerUsername).toMatch(/^seed_(rest_\d{3}|cook_\d+)$/);
    }
  });

  it('is relative to the run time', () => {
    const later = planSellerInbox(new Date(NOW.getTime() + HOUR));
    expect(later[0].pickupAt.getTime() - plan[0].pickupAt.getTime()).toBe(HOUR);
  });
});

describe('needsAddressSnapshot', () => {
  const base = { target: { kind: 'homemade' as const, ownerUsername: 'seed_cook_1' } };
  const soon = new Date(NOW.getTime() - HOUR);

  it.each(['accepted', 'completed', 'no_show'] as const)(
    'copies the cook address for a homemade %s request',
    (status) => {
      expect(needsAddressSnapshot({ ...base, status, pickupAt: soon }, NOW)).toBe(true);
    },
  );

  it.each(['pending', 'declined', 'cancelled', 'expired'] as const)(
    'never for a homemade %s request (the table forbids it)',
    (status) => {
      expect(needsAddressSnapshot({ ...base, status, pickupAt: soon }, NOW)).toBe(false);
    },
  );

  it('never for a restaurant', () => {
    expect(
      needsAddressSnapshot(
        {
          target: { kind: 'restaurant', ownerUsername: 'seed_rest_001' },
          status: 'accepted',
          pickupAt: soon,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it('not once the pickup is more than 24 hours ago (the expiry job clears it there)', () => {
    const old = new Date(NOW.getTime() - 25 * HOUR);
    expect(needsAddressSnapshot({ ...base, status: 'completed', pickupAt: old }, NOW)).toBe(false);
  });

  it('every homemade accepted / completed / no_show row in the seed plans gets one, none else', () => {
    for (const row of [...planRequests(NOW), ...planSellerInbox(NOW)]) {
      const expected =
        row.target.kind === 'homemade' && ['accepted', 'completed', 'no_show'].includes(row.status);
      expect(needsAddressSnapshot(row, NOW)).toBe(expected);
      if (expected) expect(row.respondedAt).not.toBeNull();
    }
  });
});

describe('parseInboxExtra / planInboxExtra', () => {
  it('is null without the flag, 60 with the bare flag, and N with a number', () => {
    expect(parseInboxExtra([])).toBeNull();
    expect(parseInboxExtra(['--extra', '5'])).toBeNull();
    expect(parseInboxExtra(['--inbox-extra'])).toBe(60);
    expect(parseInboxExtra(['--inbox-extra', '--extra'])).toBe(60);
    expect(parseInboxExtra(['--inbox-extra', '75'])).toBe(75);
  });

  it('refuses a bad number', () => {
    expect(() => parseInboxExtra(['--inbox-extra', 'many'])).toThrow(/whole number/);
    expect(() => parseInboxExtra(['--inbox-extra', '0'])).toThrow(/between 1 and/);
    expect(() => parseInboxExtra(['--inbox-extra', String(MAX_EXTRA + 1)])).toThrow(
      /between 1 and/,
    );
  });

  it('adds N older rows to seed_rest_001: none pending, every created_at different, before the main plan', () => {
    const rows = planInboxExtra(NOW, 60);
    expect(rows).toHaveLength(60);
    expect(rows.every((row) => row.status !== 'pending')).toBe(true);
    expect(rows.every((row) => row.target.ownerUsername === 'seed_rest_001')).toBe(true);
    expect(new Set(rows.map((row) => row.createdAt.getTime())).size).toBe(60);
    const oldestMain = Math.min(...planSellerInbox(NOW).map((row) => row.createdAt.getTime()));
    expect(Math.max(...rows.map((row) => row.createdAt.getTime()))).toBeLessThan(oldestMain);
  });

  it('follows the table rules and gives answered rows a response time', () => {
    for (const row of planInboxExtra(NOW, 30)) {
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(row.pickupAt.getTime());
      expect(row.itemCount > 0 || row.orderText !== null).toBe(true);
      const answered = ['accepted', 'declined', 'completed', 'no_show'].includes(row.status);
      expect(row.respondedAt === null).toBe(!answered);
    }
  });
});
