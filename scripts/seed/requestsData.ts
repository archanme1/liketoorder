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

export type PlannedRequest = {
  key: string;
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
};

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
