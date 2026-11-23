// Demo promotions (spec 16, 16b): one campaign in each state a seller and a customer can see. Pure, so
// it is unit-tested; scripts/seed/promotions.ts writes the rows.

export type PromotionCategory = 'new_dish' | 'special_offer' | 'featured';
export type SeedPromotionState =
  'active' | 'scheduled' | 'ended' | 'requested' | 'payment_due' | 'paid_scheduled';

/**
 * Spec 16b: the fake Stripe payment row of a demo campaign. Obvious fakes that match the table's id
 * checks; no real Stripe object exists, and nothing here is ever sent to Stripe.
 */
export type PlannedPayment = {
  status: 'open' | 'paid';
  customerId: string;
  invoiceId: string;
  paymentIntentId: string | null;
};

export type PlannedPromotion = {
  state: SeedPromotionState;
  /** A demo restaurant created by scripts/seed/restaurants.ts. */
  ownerUsername: string;
  ownerEmail: string;
  category: PromotionCategory;
  headline: string;
  /** Stored status: scheduled, active and ended are all 'approved', told apart by the window. */
  status: 'approved' | 'requested' | 'payment_due';
  /** Spec 16b: approved by hand with no payment (every demo except the paid one). */
  isFree: boolean;
  /** Spec 16b: the end of the payment window (payment_due only). */
  payBy: string | null;
  /** Spec 16b: when Stripe took the money (the paid demo only). */
  paidAt: string | null;
  payment: PlannedPayment | null;
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
  payment_due: '007',
  paid_scheduled: '008',
};

const NOT_PAID = { payBy: null, paidAt: null, payment: null } as const;

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
      isFree: true,
      ...NOT_PAID,
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
      isFree: true,
      ...NOT_PAID,
      preferredStart: utcDay(at(2)),
      ...window(2),
    },
    {
      state: 'ended',
      ...owner('ended'),
      category: 'featured',
      headline: 'Fresh tacos every day',
      status: 'approved',
      isFree: true,
      ...NOT_PAID,
      preferredStart: null,
      ...window(-(lengthDays + 3)),
    },
    {
      state: 'requested',
      ...owner('requested'),
      category: 'new_dish',
      headline: 'New lamb souvlaki plate',
      status: 'requested',
      isFree: false,
      ...NOT_PAID,
      preferredStart: utcDay(at(3)),
      startsAt: null,
      endsAt: null,
    },
    {
      // Spec 16b: headline approved, invoice sent, waiting for the money (7-day window).
      state: 'payment_due',
      ...owner('payment_due'),
      category: 'special_offer',
      headline: 'Bento lunch box with free miso soup',
      status: 'payment_due',
      isFree: false,
      payBy: at(7).toISOString(),
      paidAt: null,
      payment: {
        status: 'open',
        customerId: 'cus_FakeSeed0001',
        invoiceId: 'in_FakeSeed0001',
        paymentIntentId: null,
      },
      preferredStart: null,
      startsAt: null,
      endsAt: null,
    },
    {
      // Spec 16b: paid an hour ago, starting on its preferred day.
      state: 'paid_scheduled',
      ...owner('paid_scheduled'),
      category: 'featured',
      headline: 'Green curry made to order',
      status: 'approved',
      isFree: false,
      payBy: null,
      paidAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      payment: {
        status: 'paid',
        customerId: 'cus_FakeSeed0002',
        invoiceId: 'in_FakeSeed0002',
        paymentIntentId: 'pi_FakeSeed0002',
      },
      preferredStart: utcDay(at(2)),
      ...window(2),
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
    isFree: true,
    ...NOT_PAID,
    preferredStart: null,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  }));
}

// --offers (spec 16 PR 4): 22 campaigns running now, more than one Offers page of 20, so paging can
// be tried in the Simulator. Everything within "About 30 km" of Oshawa (34 km from its grid point
// 43.9, -78.85, the server's 4 km margin included): the 14 Oshawa restaurants, Whitby (045, 7 km),
// Ajax (044, 15 km), Pickering (043, 20 km), Scarborough (040, 34 km) and the 5 Oshawa home cooks.
// Only seed_rest_001 is left out (kept for the Promote invitation). Unlike --many, this mode also
// promotes seed_rest_004, seed_rest_010 and seed_cook_1. At "About 15 km" (19 km) it gives exactly
// 20 offers (no second page); only "About 30 km" shows paging (20, then 2).
const OFFERS_RESTAURANTS = [
  '002',
  '003',
  '004',
  '005',
  '006',
  '007',
  '008',
  '009',
  '010',
  '011',
  '012',
  '013',
  '014',
  '040',
  '043',
  '044',
  '045',
];
const OFFERS_COOKS = [1, 2, 3, 4, 5];

const OFFERS_LINES: { category: PromotionCategory; headline: string }[] = [
  { category: 'special_offer', headline: 'Pho for two, spring rolls on us' },
  { category: 'new_dish', headline: 'New: tandoori mixed grill' },
  { category: 'featured', headline: 'Jerk chicken, Saturday special' },
  { category: 'special_offer', headline: 'Taco Tuesday, three for two' },
  { category: 'new_dish', headline: 'New: lamb gyro platter' },
  { category: 'featured', headline: 'Bento boxes made fresh daily' },
  { category: 'special_offer', headline: 'Pad thai lunch with free iced tea' },
  { category: 'new_dish', headline: 'New: haddock and mushy peas' },
  { category: 'featured', headline: 'Korean fried chicken, our classic' },
  { category: 'special_offer', headline: 'Piri piri chicken, half price Mondays' },
  { category: 'new_dish', headline: 'New: falafel and halloumi plate' },
  { category: 'featured', headline: 'Smoked brisket, 12 hours low and slow' },
  { category: 'special_offer', headline: 'Late-night street tacos, two for one' },
  { category: 'new_dish', headline: 'New: chicken adobo rice bowl' },
  { category: 'featured', headline: 'Fish tacos by the bay' },
  { category: 'special_offer', headline: 'Arepas lunch combo with a drink' },
  { category: 'new_dish', headline: 'New: weekend brunch board' },
  { category: 'featured', headline: 'Fresh pasta every Friday' },
  { category: 'special_offer', headline: 'Jollof tray for four, dessert free' },
  { category: 'new_dish', headline: 'New: dosa with three chutneys' },
  { category: 'featured', headline: 'Empanadas baked to order' },
  { category: 'special_offer', headline: 'Banchan set, an extra side free' },
];

/** 22 active campaigns (17 restaurants, 5 home cooks), each started half its length ago. */
export function planOffersPromotions(now: Date, lengthDays: number): PlannedPromotion[] {
  const owners = [
    ...OFFERS_RESTAURANTS.map((n) => ({
      ownerUsername: `seed_rest_${n}`,
      ownerEmail: `seed-restaurant-${n}@example.com`,
    })),
    ...OFFERS_COOKS.map((n) => ({
      ownerUsername: `seed_cook_${n}`,
      ownerEmail: `seed-homemade-${n}@example.com`,
    })),
  ];
  const startsAt = new Date(now.getTime() - (lengthDays / 2) * DAY_MS);
  const endsAt = new Date(startsAt.getTime() + lengthDays * DAY_MS);
  return owners.map((owner, index) => ({
    state: 'active',
    ...owner,
    ...OFFERS_LINES[index],
    status: 'approved',
    isFree: true,
    ...NOT_PAID,
    preferredStart: null,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  }));
}

export type SeedMode = 'default' | 'many' | 'offers';

const MODE_ARGS: ReadonlySet<string> = new Set(['--many', '--offers']);

/**
 * The flag of scripts/seed/promotions.ts: none, --many or --offers. Any other argument, or both
 * flags together, is refused, so a typo never quietly writes the default four campaigns.
 */
export function parseSeedMode(args: readonly string[]): SeedMode {
  const unknown = args.filter((arg) => !MODE_ARGS.has(arg));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown argument ${unknown.join(', ')}. The only options are --many and --offers.`,
    );
  }
  const many = args.includes('--many');
  const offers = args.includes('--offers');
  if (many && offers) throw new Error('Use --many or --offers, not both.');
  return offers ? 'offers' : many ? 'many' : 'default';
}

/** The campaigns one mode writes. */
export function planForMode(mode: SeedMode, now: Date, lengthDays: number): PlannedPromotion[] {
  if (mode === 'offers') return planOffersPromotions(now, lengthDays);
  if (mode === 'many') return planManyPromotions(now, lengthDays);
  return planPromotions(now, lengthDays);
}

/**
 * Every demo owner any mode uses. Each mode first removes the campaigns of all of them, so switching
 * between the default seed, --many and --offers never leaves rows from another mode behind.
 */
export function promotionSeedOwners(now: Date, lengthDays: number): string[] {
  const all = [
    ...planPromotions(now, lengthDays),
    ...planManyPromotions(now, lengthDays),
    ...planOffersPromotions(now, lengthDays),
  ];
  return [...new Set(all.map((plan) => plan.ownerUsername))].sort();
}
