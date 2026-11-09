// Demo pickup requests for the LOCAL database. Pure planning (no database, no network) so it is
// unit-tested; scripts/seed/requests.ts turns the plan into rows. All times are relative to the
// moment the seed runs, so the seed must be re-run for fresh times.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const CUSTOMER_EMAIL = 'seed-customer@example.com';
export const CUSTOMER_USERNAME = 'seed_customer';

export type RequestStatus =
  'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'completed' | 'no_show';

/** Which demo business a request goes to: the profile username of its owner (set by restaurants.ts). */
export type Target = { kind: 'restaurant' | 'homemade'; ownerUsername: string };

export type CustomerKey = 'demo' | 'sam' | 'priya';

export type SeedCustomer = {
  key: CustomerKey;
  email: string;
  username: string;
  displayName: string;
};

/**
 * Every demo customer. The first is the original one (spec 09); the other two give the seller
 * inbox (spec 10) different names to read. All are seed-*@example.com, so the seed may delete them.
 */
export const SEED_CUSTOMERS: readonly SeedCustomer[] = [
  { key: 'demo', email: CUSTOMER_EMAIL, username: CUSTOMER_USERNAME, displayName: 'Demo Customer' },
  {
    key: 'sam',
    email: 'seed-customer-sam@example.com',
    username: 'seed_customer_sam',
    displayName: 'Sam Rivera',
  },
  {
    key: 'priya',
    email: 'seed-customer-priya@example.com',
    username: 'seed_customer_priya',
    displayName: 'Priya Shah',
  },
];

export type PlannedRequest = {
  key: string;
  /** Which demo customer sent it (default: the original demo customer). */
  customer?: CustomerKey;
  /** What this row is for, printed by the seed. */
  purpose: string;
  target: Target;
  status: RequestStatus;
  createdAt: Date;
  pickupAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  /** How many of the business's available menu items to put in (0 = a written order only). */
  itemCount: number;
  orderText: string | null;
  note: string | null;
  /** Why it was declined (spec 10b): only on a declined row. */
  declineReason?: DeclineCode;
  /** The seller's note on an answer; for a decline it is the words behind "other" only. */
  responseNote?: string;
  /**
   * Sent by this existing demo account (a business owner) instead of one of the SEED_CUSTOMERS, to
   * try the Sent and Received switches on one phone. Its requests are removed by the seed itself.
   */
  customerUsername?: string;
};

export type DeclineCode =
  'sold_out' | 'closed_then' | 'too_busy' | 'cannot_prepare' | 'time_not_possible' | 'other';

/** The server's rule: the earlier of created + 30 minutes and the pickup time. */
export function expiryFor(createdAt: Date, pickupAt: Date): Date {
  return new Date(Math.min(createdAt.getTime() + 30 * MINUTE, pickupAt.getTime()));
}

export function planRequests(now: Date): PlannedRequest[] {
  const at = (offset: number) => new Date(now.getTime() + offset);
  const row = (
    key: string,
    purpose: string,
    target: Target,
    status: RequestStatus,
    created: number,
    pickup: number,
    extra: Partial<Pick<PlannedRequest, 'itemCount' | 'orderText' | 'note' | 'expiresAt'>> & {
      responded?: number;
    } = {},
  ): PlannedRequest => {
    const createdAt = at(created);
    const pickupAt = at(pickup);
    return {
      key,
      purpose,
      target,
      status,
      createdAt,
      pickupAt,
      expiresAt: extra.expiresAt ?? expiryFor(createdAt, pickupAt),
      respondedAt: extra.responded === undefined ? null : at(extra.responded),
      itemCount: extra.itemCount ?? 0,
      orderText: extra.orderText ?? null,
      note: extra.note ?? null,
    };
  };

  const rest = (n: number): Target => ({
    kind: 'restaurant',
    ownerUsername: `seed_rest_${String(n).padStart(3, '0')}`,
  });
  const cook = (n: number): Target => ({ kind: 'homemade', ownerUsername: `seed_cook_${n}` });

  return [
    // Created 28 minutes ago, so it expires 2 minutes after the seed runs: watch it turn Expired.
    row(
      'pending-expiring',
      'pending, expires about 2 minutes after the seed',
      rest(1),
      'pending',
      -28 * MINUTE,
      3 * HOUR,
      {
        itemCount: 2,
        note: 'Please cut the pizza in 8',
      },
    ),
    // Fresh: 30 minutes to live. Use this one to try Cancel.
    row(
      'pending-cancel-me',
      'pending, 30 minutes to live (try Cancel)',
      rest(2),
      'pending',
      0,
      3 * HOUR,
      {
        itemCount: 1,
        orderText: 'No onions, extra sauce',
      },
    ),
    // Accepted with the pickup near now (inside the 24-hour window): the address card shows.
    row(
      'accepted-homemade',
      'ACCEPTED homemade, pickup in 30 min (address visible)',
      cook(1),
      'accepted',
      -20 * MINUTE,
      30 * MINUTE,
      {
        itemCount: 2,
        responded: -10 * MINUTE,
      },
    ),
    row('declined-homemade', 'declined homemade', cook(2), 'declined', -HOUR, 2 * HOUR, {
      orderText: 'Two portions of jollof rice',
      responded: -50 * MINUTE,
    }),
    // Completed 2 hours ago, still inside the 24-hour window, so the address is still readable.
    row(
      'completed-homemade',
      'completed homemade, pickup 2 h ago (address still visible)',
      cook(3),
      'completed',
      -3.5 * HOUR,
      -2 * HOUR,
      {
        itemCount: 1,
        responded: -3 * HOUR,
      },
    ),
    row('cancelled', 'cancelled by the customer', rest(3), 'cancelled', -2 * HOUR, HOUR, {
      itemCount: 1,
    }),
    // The cron job has already swept this one.
    row('expired', 'expired (no answer)', rest(4), 'expired', -3 * HOUR, -2 * HOUR, {
      orderText: 'A large margherita',
    }),
    row(
      'completed-restaurant',
      'completed restaurant, a day ago',
      rest(5),
      'completed',
      -27 * HOUR,
      -26 * HOUR,
      {
        itemCount: 2,
        responded: -26.5 * HOUR,
      },
    ),
    row('no-show', 'marked no-show', rest(6), 'no_show', -6 * HOUR, -5 * HOUR, {
      itemCount: 1,
      responded: -5.5 * HOUR,
    }),
  ];
}

/** Most extra requests one run will add. */
export const MAX_EXTRA = 1000;

/**
 * Reads "--extra" / "--extra N" from the command line: how many extra requests to add for testing
 * pagination (default 120). Null when the flag is absent; throws on a bad number.
 */
export function parseExtra(args: readonly string[]): number | null {
  const at = args.indexOf('--extra');
  if (at === -1) return null;
  const given = args[at + 1];
  if (given === undefined || given.startsWith('--')) return 120;
  if (!/^\d+$/.test(given)) throw new Error('--extra needs a whole number, e.g. --extra 120');
  const count = Number(given);
  if (count < 1 || count > MAX_EXTRA) {
    throw new Error(`--extra must be between 1 and ${MAX_EXTRA}.`);
  }
  return count;
}

const EXTRA_STATUSES: RequestStatus[] = [
  'completed',
  'declined',
  'cancelled',
  'expired',
  'completed',
  'no_show',
  'declined',
];

/**
 * `count` older requests for testing pagination: no pending ones, every created_at different
 * (7 minutes apart, so no two rows tie at a page boundary), all older than the main plan's rows.
 * They go to the other demo restaurants and cooks (not the ones the main plan uses).
 */
export function planExtraRequests(now: Date, count: number): PlannedRequest[] {
  const rows: PlannedRequest[] = [];
  for (let i = 0; i < count; i++) {
    const status = EXTRA_STATUSES[i % EXTRA_STATUSES.length];
    const createdAt = new Date(now.getTime() - 30 * HOUR - i * 7 * MINUTE);
    const pickupAt = new Date(createdAt.getTime() + HOUR);
    const answered = status === 'completed' || status === 'declined' || status === 'no_show';
    const target: Target =
      i % 4 === 3
        ? { kind: 'homemade', ownerUsername: `seed_cook_${4 + (Math.floor(i / 4) % 10)}` }
        : {
            kind: 'restaurant',
            ownerUsername: `seed_rest_${String(7 + (i % 34)).padStart(3, '0')}`,
          };
    const itemCount = i % 3 === 0 ? 1 : 0;
    rows.push({
      key: `extra-${i + 1}`,
      purpose: 'pagination test',
      target,
      status,
      createdAt,
      pickupAt,
      expiresAt: expiryFor(createdAt, pickupAt),
      respondedAt: answered ? new Date(createdAt.getTime() + 10 * MINUTE) : null,
      itemCount,
      orderText: itemCount === 0 ? `Pagination test order ${i + 1}` : null,
      note: null,
    });
  }
  return rows;
}

export type MenuLineRow = {
  id: string;
  name: string;
  price_minor: number | null;
};

/** The snapshot the server writes into `items`: the first `count` lines, 1 or 2 of each. */
export function snapshotItems(
  menu: readonly MenuLineRow[],
  count: number,
): { item_id: string; name: string; unit_price_minor: number | null; quantity: number }[] | null {
  const lines = menu.slice(0, count);
  if (lines.length === 0) return null;
  return lines.map((line, index) => ({
    item_id: line.id,
    name: line.name,
    unit_price_minor: line.price_minor,
    quantity: index === 0 ? 2 : 1,
  }));
}

// ── Seller inbox (spec 10) ───────────────────────────────────────────────────────────────────
const ANSWERED: readonly RequestStatus[] = ['accepted', 'declined', 'completed', 'no_show'];

/**
 * Whether the seed copies the cook's current address into `accepted_address`, like
 * respond_to_request does at Accept: homemade, accepted / completed / no_show, and the pickup is
 * still inside the 24 hours after which the expiry job clears the snapshot.
 */
export function needsAddressSnapshot(
  plan: Pick<PlannedRequest, 'target' | 'status' | 'pickupAt'>,
  now: Date,
): boolean {
  return (
    plan.target.kind === 'homemade' &&
    (plan.status === 'accepted' || plan.status === 'completed' || plan.status === 'no_show') &&
    plan.pickupAt.getTime() > now.getTime() - 24 * HOUR
  );
}

/**
 * Requests for ONE restaurant (seed_rest_001) and ONE cook (seed_cook_1), from three customers, so
 * a seller can try every inbox action: Accept and Decline, Completed and No-show (pickup already
 * passed), an accepted request that has to wait for its pickup time, and the homemade Accept that
 * shows the address notice. Times are relative to `now`: re-run the seed for fresh times.
 */
export function planSellerInbox(now: Date): PlannedRequest[] {
  const at = (offset: number) => new Date(now.getTime() + offset);
  const rest: Target = { kind: 'restaurant', ownerUsername: 'seed_rest_001' };
  const cook: Target = { kind: 'homemade', ownerUsername: 'seed_cook_1' };
  const row = (
    key: string,
    purpose: string,
    target: Target,
    customer: CustomerKey,
    status: RequestStatus,
    created: number,
    pickup: number,
    extra: { responded?: number; itemCount?: number; orderText?: string; note?: string } = {},
  ): PlannedRequest => {
    const createdAt = at(created);
    const pickupAt = at(pickup);
    return {
      key: `inbox-${key}`,
      purpose,
      customer,
      target,
      status,
      createdAt,
      pickupAt,
      expiresAt: expiryFor(createdAt, pickupAt),
      respondedAt: extra.responded === undefined ? null : at(extra.responded),
      itemCount: extra.itemCount ?? 0,
      orderText: extra.orderText ?? null,
      note: extra.note ?? null,
    };
  };

  return [
    row('accept-me', 'inbox: pending, try ACCEPT', rest, 'sam', 'pending', -2 * MINUTE, 2 * HOUR, {
      itemCount: 2,
      note: 'Extra napkins please',
    }),
    row(
      'decline-me',
      'inbox: pending, try DECLINE',
      rest,
      'priya',
      'pending',
      -5 * MINUTE,
      3 * HOUR,
      { orderText: 'One large margherita, no basil' },
    ),
    row(
      'complete-me',
      'inbox: accepted, pickup 20 min ago, try MARK COMPLETED',
      rest,
      'sam',
      'accepted',
      -3 * HOUR,
      -20 * MINUTE,
      { itemCount: 1, responded: -2.5 * HOUR },
    ),
    row(
      'noshow-me',
      'inbox: accepted, pickup 40 min ago, try MARK NO-SHOW',
      rest,
      'priya',
      'accepted',
      -4 * HOUR,
      -40 * MINUTE,
      { itemCount: 2, responded: -3.5 * HOUR },
    ),
    row(
      'accepted-later',
      'inbox: accepted, pickup in 2 h (no buttons yet)',
      rest,
      'sam',
      'accepted',
      -HOUR,
      2 * HOUR,
      { itemCount: 1, responded: -50 * MINUTE },
    ),
    row('declined', 'inbox: declined', rest, 'priya', 'declined', -6 * HOUR, -4 * HOUR, {
      itemCount: 1,
      responded: -5.5 * HOUR,
    }),
    row(
      'cancelled',
      'inbox: cancelled by the customer',
      rest,
      'sam',
      'cancelled',
      -7 * HOUR,
      -5 * HOUR,
      {
        itemCount: 1,
      },
    ),
    row('expired', 'inbox: expired', rest, 'priya', 'expired', -8 * HOUR, -6 * HOUR, {
      orderText: 'A large pepperoni',
    }),
    row('completed', 'inbox: completed', rest, 'sam', 'completed', -9 * HOUR, -8 * HOUR, {
      itemCount: 2,
      responded: -8.5 * HOUR,
    }),
    row('no-show', 'inbox: no-show', rest, 'priya', 'no_show', -10 * HOUR, -9 * HOUR, {
      itemCount: 1,
      responded: -9.5 * HOUR,
    }),
    row(
      'cook-accept-me',
      'inbox (cook): pending, try ACCEPT (the address notice)',
      cook,
      'priya',
      'pending',
      -3 * MINUTE,
      2 * HOUR,
      { itemCount: 1, note: 'Allergic to peanuts' },
    ),
    row(
      'cook-complete-me',
      'inbox (cook): accepted, pickup 15 min ago, try MARK COMPLETED',
      cook,
      'sam',
      'accepted',
      -2 * HOUR,
      -15 * MINUTE,
      { itemCount: 1, responded: -1.5 * HOUR },
    ),
  ];
}

/** Reads a "--flag" / "--flag N" count (default `fallback`). Null when absent; throws on a bad number. */
function parseCountFlag(args: readonly string[], flag: string, fallback: number): number | null {
  const at = args.indexOf(flag);
  if (at === -1) return null;
  const given = args[at + 1];
  if (given === undefined || given.startsWith('--')) return fallback;
  if (!/^\d+$/.test(given))
    throw new Error(`${flag} needs a whole number, e.g. ${flag} ${fallback}`);
  const count = Number(given);
  if (count < 1 || count > MAX_EXTRA)
    throw new Error(`${flag} must be between 1 and ${MAX_EXTRA}.`);
  return count;
}

/** "--inbox-extra" / "--inbox-extra N": older requests to seed_rest_001, so its inbox passes 50. Default 60. */
export function parseInboxExtra(args: readonly string[]): number | null {
  return parseCountFlag(args, '--inbox-extra', 60);
}

const INBOX_EXTRA_STATUSES: RequestStatus[] = [
  'declined',
  'completed',
  'cancelled',
  'expired',
  'no_show',
];

/**
 * `count` older requests to seed_rest_001 for trying the inbox's infinite scroll: no pending ones,
 * every created_at different (7 minutes apart), all older than the main inbox plan's rows.
 */
export function planInboxExtra(now: Date, count: number): PlannedRequest[] {
  const target: Target = { kind: 'restaurant', ownerUsername: 'seed_rest_001' };
  const customers: CustomerKey[] = ['sam', 'priya', 'demo'];
  const rows: PlannedRequest[] = [];
  for (let i = 0; i < count; i++) {
    const status = INBOX_EXTRA_STATUSES[i % INBOX_EXTRA_STATUSES.length];
    const createdAt = new Date(now.getTime() - 40 * HOUR - i * 7 * MINUTE);
    const pickupAt = new Date(createdAt.getTime() + HOUR);
    const itemCount = i % 3 === 0 ? 1 : 0;
    rows.push({
      key: `inbox-extra-${i + 1}`,
      purpose: 'inbox pagination test',
      customer: customers[i % customers.length],
      target,
      status,
      createdAt,
      pickupAt,
      expiresAt: expiryFor(createdAt, pickupAt),
      respondedAt: ANSWERED.includes(status) ? new Date(createdAt.getTime() + 10 * MINUTE) : null,
      itemCount,
      orderText: itemCount === 0 ? `Inbox pagination test order ${i + 1}` : null,
      note: null,
    });
  }
  return rows;
}

/**
 * Answered requests for spec 10b: one declined request for each reason (and "other" with the
 * seller's own words), accepted requests with a note, and a business owner (seed_rest_001) who is
 * also a customer, so Requests shows Received and Sent on one account. The table checks are
 * followed here (a reason only on a declined row, a fixed reason has no note, "other" has one, a
 * note only on an answered row), because these rows are inserted directly. Pickup times are ahead,
 * so the rows read as recent answers. Times are relative to `now`.
 */
export function planAnswerNotes(now: Date): PlannedRequest[] {
  const at = (offset: number) => new Date(now.getTime() + offset);
  const rest = (n: number): Target => ({
    kind: 'restaurant',
    ownerUsername: `seed_rest_${String(n).padStart(3, '0')}`,
  });
  const cook = (n: number): Target => ({ kind: 'homemade', ownerUsername: `seed_cook_${n}` });
  const row = (
    key: string,
    purpose: string,
    target: Target,
    status: RequestStatus,
    created: number,
    pickup: number,
    extra: Partial<
      Pick<
        PlannedRequest,
        'customer' | 'customerUsername' | 'declineReason' | 'responseNote' | 'note' | 'orderText'
      >
    > & { responded?: number; itemCount?: number } = {},
  ): PlannedRequest => {
    const createdAt = at(created);
    const pickupAt = at(pickup);
    const { responded, itemCount, ...rest } = extra;
    return {
      key: `answer-${key}`,
      purpose,
      target,
      status,
      createdAt,
      pickupAt,
      expiresAt: expiryFor(createdAt, pickupAt),
      respondedAt: responded === undefined ? null : at(responded),
      itemCount: itemCount ?? 0,
      orderText: rest.orderText ?? null,
      note: rest.note ?? null,
      ...(rest.customer ? { customer: rest.customer } : {}),
      ...(rest.customerUsername ? { customerUsername: rest.customerUsername } : {}),
      ...(rest.declineReason ? { declineReason: rest.declineReason } : {}),
      ...(rest.responseNote ? { responseNote: rest.responseNote } : {}),
    };
  };
  const declined = (reason: DeclineCode, n: number, responseNote?: string): PlannedRequest =>
    row(
      `declined-${reason}`,
      responseNote
        ? `DECLINED, "other": the seller's own words (${responseNote})`
        : `DECLINED: ${reason.replace('_', ' ')}`,
      rest(n),
      'declined',
      -50 * MINUTE,
      3 * HOUR,
      {
        responded: -40 * MINUTE,
        itemCount: 1,
        declineReason: reason,
        ...(responseNote ? { responseNote } : {}),
      },
    );

  return [
    declined('sold_out', 2),
    declined('closed_then', 3),
    declined('too_busy', 4),
    declined('cannot_prepare', 5),
    declined('time_not_possible', 6),
    declined('other', 7, 'The oven is broken today, sorry'),
    row(
      'accepted-restaurant-note',
      'ACCEPTED restaurant with a note ("Please bring a bag")',
      rest(8),
      'accepted',
      -45 * MINUTE,
      2 * HOUR,
      { responded: -35 * MINUTE, itemCount: 2, responseNote: 'Please bring a bag' },
    ),
    row(
      'accepted-homemade-note',
      'ACCEPTED homemade with a note, pickup in 40 min (note and address visible)',
      cook(3),
      'accepted',
      -30 * MINUTE,
      40 * MINUTE,
      { responded: -25 * MINUTE, itemCount: 1, responseNote: 'Ring the side bell, please' },
    ),
    // seed_rest_001 as a customer: its Requests tab then has Received (spec 10 rows) and Sent.
    row(
      'owner-sent-accepted',
      'seed_rest_001 as a customer: ACCEPTED with a note',
      rest(9),
      'accepted',
      -40 * MINUTE,
      2 * HOUR,
      {
        customerUsername: 'seed_rest_001',
        responded: -30 * MINUTE,
        itemCount: 1,
        responseNote: 'Ready 10 minutes early',
      },
    ),
    row(
      'owner-sent-declined',
      'seed_rest_001 as a customer: DECLINED, sold out',
      cook(4),
      'declined',
      -40 * MINUTE,
      3 * HOUR,
      {
        customerUsername: 'seed_rest_001',
        responded: -30 * MINUTE,
        orderText: 'A tray of lasagne',
        declineReason: 'sold_out',
      },
    ),
    row(
      'owner-sent-pending',
      'seed_rest_001 as a customer: PENDING (fresh, 30 minutes to live)',
      rest(10),
      'pending',
      0,
      3 * HOUR,
      { customerUsername: 'seed_rest_001', itemCount: 1 },
    ),
  ];
}
