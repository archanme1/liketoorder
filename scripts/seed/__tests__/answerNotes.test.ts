import { RESTAURANTS } from '../restaurantData';
import { HOMEMADE_COOKS } from '../homemadeData';
import {
  expiryFor,
  needsAddressSnapshot,
  planAnswerNotes,
  planRequests,
  planSellerInbox,
  type DeclineCode,
} from '../requestsData';

const NOW = new Date('2026-11-08T17:00:00Z');
const MIN = 60_000;
const plan = planAnswerNotes(NOW);
const ALL: DeclineCode[] = [
  'sold_out',
  'closed_then',
  'too_busy',
  'cannot_prepare',
  'time_not_possible',
  'other',
];

describe('planAnswerNotes (spec 10b seed rows)', () => {
  it('has a declined request for each of the six reasons', () => {
    const reasons = plan.filter((row) => row.status === 'declined' && row.declineReason);
    for (const code of ALL) {
      expect(reasons.some((row) => row.declineReason === code)).toBe(true);
    }
  });

  it('follows the table checks, because these rows are inserted directly', () => {
    for (const row of plan) {
      // A reason only on a declined row.
      if (row.declineReason) expect(row.status).toBe('declined');
      // A note only on an answered row.
      if (row.responseNote) {
        expect(['accepted', 'declined', 'completed', 'no_show']).toContain(row.status);
        expect(row.responseNote).toBe(row.responseNote.trim());
        expect(row.responseNote.length).toBeGreaterThanOrEqual(1);
        expect(row.responseNote.length).toBeLessThanOrEqual(200);
        // No hidden characters.
        expect(row.responseNote).not.toMatch(
          /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/,
        );
      }
      // "other" carries its words; a fixed reason never carries a note.
      if (row.declineReason === 'other') expect(row.responseNote).toBeDefined();
      if (row.status === 'declined' && row.responseNote) expect(row.declineReason).toBe('other');
      if (row.declineReason && row.declineReason !== 'other') {
        expect(row.responseNote).toBeUndefined();
      }
    }
  });

  it('has accepted requests that carry a note, one of them homemade', () => {
    const accepted = plan.filter((row) => row.status === 'accepted' && row.responseNote);
    expect(accepted.length).toBeGreaterThanOrEqual(2);
    expect(accepted.some((row) => row.target.kind === 'homemade')).toBe(true);
    expect(accepted.some((row) => row.target.kind === 'restaurant')).toBe(true);
  });

  it('has a business owner who is also a customer, with sent requests of different statuses', () => {
    const sent = plan.filter((row) => row.customerUsername === 'seed_rest_001');
    expect(sent.map((row) => row.status).sort()).toEqual(['accepted', 'declined', 'pending']);
    for (const row of sent) {
      // Never to its own business (submit_pickup_request refuses own_business, and so should a demo).
      expect(row.target.ownerUsername).not.toBe('seed_rest_001');
    }
  });

  it('only involves demo accounts that restaurants.ts creates', () => {
    for (const row of plan) {
      expect(row.target.ownerUsername).toMatch(/^seed_(rest_\d{3}|cook_\d+)$/);
      const n = Number(row.target.ownerUsername.split('_').pop());
      if (row.target.kind === 'restaurant') expect(n).toBeLessThanOrEqual(RESTAURANTS.length);
      else expect(n).toBeLessThanOrEqual(HOMEMADE_COOKS.length);
      if (row.customerUsername)
        expect(row.customerUsername).toMatch(/^seed_(rest_\d{3}|cook_\d+)$/);
    }
  });

  it('uses keys no other seed row uses', () => {
    const others = new Set([...planRequests(NOW), ...planSellerInbox(NOW)].map((row) => row.key));
    const keys = plan.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(others.has(key)).toBe(false);
  });

  it('follows the table rules for times, like every other seed row', () => {
    for (const row of plan) {
      expect(row.expiresAt.getTime()).toBe(expiryFor(row.createdAt, row.pickupAt).getTime());
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      if (row.status !== 'pending') {
        expect(row.respondedAt).not.toBeNull();
        expect(row.respondedAt!.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime());
        expect(row.expiresAt.getTime()).toBeLessThanOrEqual(NOW.getTime() + 30 * MIN);
      } else {
        expect(row.respondedAt).toBeNull();
      }
    }
  });

  it('gives the accepted homemade rows the address snapshot, as respond_to_request does', () => {
    const homemade = plan.filter(
      (row) => row.status === 'accepted' && row.target.kind === 'homemade',
    );
    expect(homemade.length).toBeGreaterThan(0);
    for (const row of homemade) expect(needsAddressSnapshot(row, NOW)).toBe(true);
  });

  it('leaves the rows before it unchanged: the first accepted and declined are still homemade', () => {
    const earlier = [...planRequests(NOW)];
    expect(earlier.find((row) => row.status === 'accepted')?.target.kind).toBe('homemade');
    expect(earlier.find((row) => row.status === 'declined')?.target.kind).toBe('homemade');
  });
});
