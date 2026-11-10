import { RESTAURANTS } from '../restaurantData';
import { SEED_CUSTOMERS } from '../requestsData';
import { TABLE_TARGETS, planTableRequests, tableExpiryFor } from '../tableRequestsData';

const NOW = new Date('2026-11-08T17:00:00Z');
const HOUR = 3_600_000;
const plan = planTableRequests(NOW);
const byKey = (key: string) => {
  const row = plan.find((candidate) => candidate.key === key);
  if (!row) throw new Error(`no row ${key}`);
  return row;
};

describe('planTableRequests (spec 11 seed rows)', () => {
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
      expect(statuses.has(status as never)).toBe(true);
    }
  });

  it('has a declined request for each of the five table reasons', () => {
    const reasons = new Set(
      plan.filter((row) => row.status === 'declined').map((r) => r.declineReason),
    );
    expect(reasons).toEqual(
      new Set(['fully_booked', 'closed_then', 'too_busy', 'time_not_possible', 'other']),
    );
  });

  it('follows the table checks, because these rows are inserted directly', () => {
    const fixed = ['fully_booked', 'closed_then', 'too_busy', 'time_not_possible'];
    for (const row of plan) {
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(row.tableAt.getTime());
      expect(row.partySize).toBeGreaterThanOrEqual(1);
      expect(row.partySize).toBeLessThanOrEqual(20);
      if (row.declineReason) expect(row.status).toBe('declined');
      if (row.status === 'declined') expect(row.declineReason).not.toBeNull();
      if (row.responseNote) {
        expect(['accepted', 'declined', 'completed', 'no_show']).toContain(row.status);
        expect(row.responseNote).toBe(row.responseNote.trim());
        expect(row.responseNote.length).toBeLessThanOrEqual(200);
      }
      if (row.declineReason === 'other') expect(row.responseNote).not.toBeNull();
      if (row.declineReason && fixed.includes(row.declineReason)) {
        expect(row.responseNote).toBeNull();
      }
      if (row.arrivedAt) expect(['accepted', 'completed', 'no_show']).toContain(row.status);
      if (row.note) expect(row.note.length).toBeLessThanOrEqual(300);
      // An answered row was answered after it was sent.
      if (row.respondedAt)
        expect(row.respondedAt.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime());
    }
  });

  it('uses the server expiry rule for rows that have not expired', () => {
    for (const row of plan.filter((r) => r.status !== 'expired')) {
      expect(row.expiresAt.getTime()).toBe(tableExpiryFor(row.createdAt, row.tableAt).getTime());
    }
  });

  it('only goes to restaurants that accept table requests, and from known customers', () => {
    const accepts = (username: string) => {
      const n = Number(username.replace('seed_rest_', ''));
      return n >= 1 && n <= RESTAURANTS.length && (n - 1) % 3 === 0;
    };
    for (const target of TABLE_TARGETS) expect(accepts(target)).toBe(true);
    const customers = new Set(SEED_CUSTOMERS.map((customer) => customer.key));
    for (const row of plan) {
      expect(accepts(row.ownerUsername)).toBe(true);
      expect(customers.has(row.customer)).toBe(true);
    }
  });

  it('has an accepted request inside the arrival window, one too early, one too late, and one arrived', () => {
    const open = byKey('arrive-open');
    expect(open.status).toBe('accepted');
    expect(open.arrivedAt).toBeNull();
    expect(open.tableAt.getTime() - NOW.getTime()).toBeGreaterThan(-4 * HOUR);
    expect(open.tableAt.getTime() - NOW.getTime()).toBeLessThan(2 * HOUR);

    const early = byKey('arrive-early');
    expect(early.status).toBe('accepted');
    expect(early.tableAt.getTime() - NOW.getTime()).toBeGreaterThan(2 * HOUR);

    const late = byKey('arrive-late');
    expect(late.status).toBe('accepted');
    expect(NOW.getTime() - late.tableAt.getTime()).toBe(5 * HOUR);
    expect(NOW.getTime() - late.tableAt.getTime()).toBeGreaterThan(4 * HOUR);

    const arrived = byKey('arrived');
    expect(arrived.status).toBe('accepted');
    expect(arrived.arrivedAt).not.toBeNull();
  });

  it('has requests waiting at the first accepting restaurant, for its Received list', () => {
    const waiting = plan.filter(
      (r) => r.ownerUsername === 'seed_rest_001' && r.status === 'pending',
    );
    expect(waiting.length).toBeGreaterThanOrEqual(3);
  });

  it('is all relative to the time it is run', () => {
    const later = planTableRequests(new Date(NOW.getTime() + 7 * 24 * HOUR));
    expect(later[0].tableAt.getTime() - plan[0].tableAt.getTime()).toBe(7 * 24 * HOUR);
  });

  it('has unique keys', () => {
    expect(new Set(plan.map((row) => row.key)).size).toBe(plan.length);
  });
});
