import { CUSTOMER_EMAIL, expiryFor, planRequests, snapshotItems } from '../requestsData';
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
