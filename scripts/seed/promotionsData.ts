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

// --many (spec 16 PR 3): 13 campaigns running now, so the map shows more promoted places than the
// display limit of 8 large markers. All in Oshawa (one view): 11 restaurants and 2 home cooks.
// Skips seed_rest_001 (kept for the Promote invitation), 004 and 010 (other demos) and seed_cook_1
// (the demo seller of the request seeds).
const MANY_RESTAURANTS = [
  '002',
  '003',
  '005',
  '006',
  '007',
  '008',
  '009',
  '011',
  '012',
  '013',
  '014',
];
const MANY_COOKS = [2, 3];

const MANY_LINES: { category: PromotionCategory; headline: string }[] = [
  { category: 'special_offer', headline: 'Two bowls of pho for the price of one' },
  { category: 'new_dish', headline: 'New: butter chicken thali' },
  { category: 'featured', headline: 'Fresh tacos every day' },
  { category: 'new_dish', headline: 'New lamb souvlaki plate' },
  { category: 'special_offer', headline: 'Bento lunch box with free miso soup' },
  { category: 'featured', headline: 'Green curry made to order' },
  { category: 'special_offer', headline: 'Fish and chips for two on Fridays' },
  { category: 'new_dish', headline: 'New: grilled piri piri chicken' },
  { category: 'featured', headline: 'Hand-rolled falafel wraps' },
  { category: 'special_offer', headline: 'Brisket platter, sides included' },
  { category: 'featured', headline: 'Street tacos from the truck, late nights' },
  { category: 'new_dish', headline: 'New: family jollof tray' },
  { category: 'special_offer', headline: 'Curry leaf thali, extra roti free' },
];

const KNOWN_ARGS: ReadonlySet<string> = new Set(['--many']);

/**
 * The `--many` flag of scripts/seed/promotions.ts. Any other argument is refused, so a typo such as
 * `--mnay` stops the seed instead of quietly writing the default four campaigns.
 */
export function parseMany(args: readonly string[]): boolean {
  const unknown = args.filter((arg) => !KNOWN_ARGS.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown argument ${unknown.join(', ')}. The only option is --many.`);
  }
  return args.includes('--many');
}

/** 13 active campaigns (11 restaurants, 2 home cooks), each started half its length ago. */
export function planManyPromotions(now: Date, lengthDays: number): PlannedPromotion[] {
  const owners = [
    ...MANY_RESTAURANTS.map((n) => ({
      ownerUsername: `seed_rest_${n}`,
      ownerEmail: `seed-restaurant-${n}@example.com`,
    })),
    ...MANY_COOKS.map((n) => ({
      ownerUsername: `seed_cook_${n}`,
      ownerEmail: `seed-homemade-${n}@example.com`,
    })),
  ];
  const startsAt = new Date(now.getTime() - (lengthDays / 2) * DAY_MS);
  const endsAt = new Date(startsAt.getTime() + lengthDays * DAY_MS);
  return owners.map((owner, index) => ({
    state: 'active',
    ...owner,
    ...MANY_LINES[index],
    status: 'approved',
    preferredStart: null,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  }));
}

/**
 * Every demo owner either plan uses. Both modes first remove the campaigns of all of them, so a
 * switch between the default seed and --many never leaves rows from the other one behind.
 */
export function promotionSeedOwners(now: Date, lengthDays: number): string[] {
  const all = [...planPromotions(now, lengthDays), ...planManyPromotions(now, lengthDays)];
  return [...new Set(all.map((plan) => plan.ownerUsername))].sort();
}
