// Demo promotions (spec 16): one campaign in each state a seller and a customer can see. Pure, so it is
// unit-tested; scripts/seed/promotions.ts writes the rows.

export type PromotionCategory = 'new_dish' | 'special_offer' | 'featured';
export type SeedPromotionState = 'active' | 'scheduled' | 'ended' | 'requested';

export type PlannedPromotion = {
  state: SeedPromotionState;
  /** A demo restaurant created by scripts/seed/restaurants.ts. */
  ownerUsername: string;
  ownerEmail: string;
  category: PromotionCategory;
  headline: string;
  /** Stored status: scheduled, active and ended are all 'approved', told apart by the window. */
  status: 'approved' | 'requested';
  /** YYYY-MM-DD, or null. */
  preferredStart: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// seed_rest_001, 004 and 010 already carry other demos (requests, tables, limits), and 001 stays
// without a campaign so the Promote invitation can be tried on it.
const OWNERS: Record<SeedPromotionState, string> = {
  active: '002',
  scheduled: '003',
  ended: '005',
  requested: '006',
};

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The four campaigns, with windows relative to `now` and `lengthDays` long (the settings value). */
export function planPromotions(now: Date, lengthDays: number): PlannedPromotion[] {
  const at = (days: number) => new Date(now.getTime() + days * DAY_MS);
  const window = (startDays: number) => ({
    startsAt: at(startDays).toISOString(),
    endsAt: at(startDays + lengthDays).toISOString(),
  });
  const owner = (state: SeedPromotionState) => ({
    ownerUsername: `seed_rest_${OWNERS[state]}`,
    ownerEmail: `seed-restaurant-${OWNERS[state]}@example.com`,
  });

  return [
    {
      state: 'active',
      ...owner('active'),
      category: 'special_offer',
      headline: 'Two bowls of pho for the price of one',
      status: 'approved',
      preferredStart: null,
      // Started half its length ago, so it is running now for any length of 1 day or more.
      ...window(-lengthDays / 2),
    },
    {
      state: 'scheduled',
      ...owner('scheduled'),
      category: 'new_dish',
      headline: 'New: butter chicken thali',
      status: 'approved',
      preferredStart: utcDay(at(2)),
      ...window(2),
    },
    {
      state: 'ended',
      ...owner('ended'),
      category: 'featured',
      headline: 'Fresh tacos every day',
      status: 'approved',
      preferredStart: null,
      ...window(-(lengthDays + 3)),
    },
    {
      state: 'requested',
      ...owner('requested'),
      category: 'new_dish',
      headline: 'New lamb souvlaki plate',
      status: 'requested',
      preferredStart: utcDay(at(3)),
      startsAt: null,
      endsAt: null,
    },
  ];
}
