// Demo TABLE requests for the LOCAL database (spec 11). Pure planning (no database, no network) so
// it is unit-tested; scripts/seed/requests.ts turns the plan into rows of table_requests. Every
// time is relative to the moment the seed runs, so re-run the seed for fresh times: in particular
// right before trying "I've arrived", whose window is 2 hours before the table time to 4 hours
// after it.
//
// The rows are inserted directly, so they follow the table checks themselves: expires_at is never
// after table_at, a decline reason only on a declined row, a response note only on an answered row,
// "other" always carries the restaurant's own words, a fixed reason never does, and arrived_at only
// on an accepted, completed or no-show row.

import type { CustomerKey, RequestStatus } from './requestsData';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type TableDeclineCode =
  'fully_booked' | 'closed_then' | 'too_busy' | 'time_not_possible' | 'other';

/** Restaurants that accept table requests (restaurants.ts: every third one, the first included). */
export const TABLE_TARGETS = ['seed_rest_001', 'seed_rest_004'] as const;
export type TableTarget = (typeof TABLE_TARGETS)[number];

export type PlannedTableRequest = {
  key: string;
  /** What this row is for, printed by the seed. */
  purpose: string;
  customer: CustomerKey;
  /** The owner's profile username (set by restaurants.ts). */
  ownerUsername: TableTarget;
  status: RequestStatus;
  createdAt: Date;
  tableAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  arrivedAt: Date | null;
  partySize: number;
  note: string | null;
  declineReason: TableDeclineCode | null;
  responseNote: string | null;
};

/** The server's rule: the earlier of created + 24 hours and the table time. */
export function tableExpiryFor(createdAt: Date, tableAt: Date): Date {
  return new Date(Math.min(createdAt.getTime() + DAY, tableAt.getTime()));
}

export function planTableRequests(now: Date): PlannedTableRequest[] {
  const at = (offset: number) => new Date(now.getTime() + offset);
  const rows: PlannedTableRequest[] = [];
  const add = (
    key: string,
    purpose: string,
    customer: CustomerKey,
    ownerUsername: TableTarget,
    status: RequestStatus,
    created: number,
    table: number,
    extra: {
      party?: number;
      note?: string;
      responded?: number;
      arrived?: number;
      reason?: TableDeclineCode;
      answer?: string;
      expires?: number;
    } = {},
  ) => {
    const createdAt = at(created);
    const tableAt = at(table);
    rows.push({
      key,
      purpose,
      customer,
      ownerUsername,
      status,
      createdAt,
      tableAt,
      expiresAt:
        extra.expires === undefined ? tableExpiryFor(createdAt, tableAt) : at(extra.expires),
      respondedAt: extra.responded === undefined ? null : at(extra.responded),
      arrivedAt: extra.arrived === undefined ? null : at(extra.arrived),
      partySize: extra.party ?? 2,
      note: extra.note ?? null,
      declineReason: extra.reason ?? null,
      responseNote: extra.answer ?? null,
    });
  };

  // -- The arrival window (try "I've arrived" on these) --
  add(
    'arrive-open',
    'accepted, table in 20 minutes: inside the arrival window',
    'demo',
    'seed_rest_001',
    'accepted',
    -3 * HOUR,
    20 * MINUTE,
    {
      party: 4,
      note: 'Window seat if you can',
      responded: -2 * HOUR,
      answer: 'See you at the bar first',
    },
  );
  add(
    'arrive-early',
    'accepted, table in 3 days: too early for "I\'ve arrived"',
    'demo',
    'seed_rest_004',
    'accepted',
    -2 * HOUR,
    3 * DAY,
    { party: 2, responded: -HOUR },
  );
  add(
    'arrive-late',
    'accepted, table 5 hours ago: too late for "I\'ve arrived", seller can mark Completed or No-show',
    'demo',
    'seed_rest_001',
    'accepted',
    -26 * HOUR,
    -5 * HOUR,
    { party: 3, responded: -25 * HOUR },
  );
  add(
    'arrived',
    'accepted and the customer has arrived',
    'demo',
    'seed_rest_001',
    'accepted',
    -4 * HOUR,
    HOUR,
    { party: 2, responded: -3 * HOUR, arrived: -5 * MINUTE },
  );

  // -- Waiting for the restaurant (Received > Waiting) --
  add(
    'waiting-demo',
    'pending, table in 2 days',
    'demo',
    'seed_rest_001',
    'pending',
    -10 * MINUTE,
    2 * DAY,
    { party: 6, note: 'Birthday dinner' },
  );
  add(
    'waiting-sam',
    'pending, table tomorrow',
    'sam',
    'seed_rest_001',
    'pending',
    -25 * MINUTE,
    DAY + 2 * HOUR,
    { party: 2 },
  );
  add(
    'waiting-priya',
    'pending, table in 5 days',
    'priya',
    'seed_rest_001',
    'pending',
    -HOUR,
    5 * DAY,
    { party: 8 },
  );
  add(
    'waiting-demo-004',
    'pending at the other accepting restaurant',
    'demo',
    'seed_rest_004',
    'pending',
    -5 * MINUTE,
    4 * DAY,
    { party: 3 },
  );

  // -- Declined, once for each of the five table reasons --
  add(
    'declined-fully-booked',
    'declined: Fully booked',
    'sam',
    'seed_rest_001',
    'declined',
    -5 * HOUR,
    2 * DAY,
    { party: 5, responded: -4 * HOUR, reason: 'fully_booked' },
  );
  add(
    'declined-closed-then',
    'declined: Closed at that time',
    'priya',
    'seed_rest_001',
    'declined',
    -6 * HOUR,
    3 * DAY,
    { party: 2, responded: -5 * HOUR, reason: 'closed_then' },
  );
  add(
    'declined-too-busy',
    'declined: Too busy right now',
    'demo',
    'seed_rest_001',
    'declined',
    -7 * HOUR,
    2 * DAY,
    { party: 4, responded: -6 * HOUR, reason: 'too_busy' },
  );
  add(
    'declined-time',
    "declined: Time doesn't work",
    'sam',
    'seed_rest_004',
    'declined',
    -8 * HOUR,
    4 * DAY,
    { party: 2, responded: -7 * HOUR, reason: 'time_not_possible' },
  );
  add(
    'declined-other',
    "declined: Other, in the restaurant's own words",
    'priya',
    'seed_rest_004',
    'declined',
    -9 * HOUR,
    6 * DAY,
    { party: 10, responded: -8 * HOUR, reason: 'other', answer: 'Private party that night' },
  );

  // -- Every other status --
  add(
    'accepted-note',
    'accepted with a note from the restaurant',
    'sam',
    'seed_rest_001',
    'accepted',
    -10 * HOUR,
    2 * DAY,
    { party: 4, responded: -9 * HOUR, answer: 'Table 7, by the window' },
  );
  add(
    'accepted-plain',
    'accepted without a note',
    'priya',
    'seed_rest_001',
    'accepted',
    -11 * HOUR,
    3 * DAY,
    { party: 2, responded: -10 * HOUR },
  );
  add(
    'cancelled',
    'cancelled by the customer',
    'demo',
    'seed_rest_001',
    'cancelled',
    -12 * HOUR,
    2 * DAY,
    { party: 2 },
  );
  add(
    'expired',
    'expired: the restaurant never answered',
    'priya',
    'seed_rest_001',
    'expired',
    -2 * DAY,
    3 * DAY,
    { party: 3, expires: -DAY },
  );
  add('completed', 'completed', 'sam', 'seed_rest_001', 'completed', -3 * DAY, -2 * DAY, {
    party: 4,
    responded: -3 * DAY + HOUR,
    arrived: -2 * DAY - 5 * MINUTE,
  });
  add('no-show', 'no-show', 'priya', 'seed_rest_001', 'no_show', -3 * DAY, -2 * DAY - 2 * HOUR, {
    party: 2,
    responded: -3 * DAY + 2 * HOUR,
  });

  return rows;
}
