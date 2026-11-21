import { COVER_JSON, makeOffer, offerId } from '../__fixtures__/offers';
import {
  DEFAULT_OFFER_FILTERS,
  OFFER_CURSOR_PATTERN,
  OFFER_DISTANCES,
  offerSchema,
  offersPageSchema,
} from '../schema';

// The offer keys exactly as list_offers_near builds them in 20261120214854_promotions.sql.
const SQL_KEYS = [
  'business_id',
  'type',
  'name',
  'cuisine_code',
  'lat',
  'lng',
  'accepts_table_requests',
  'category',
  'headline',
  'ends_at',
  'band',
  'cover',
];
const CURSOR = `2026-11-20|1|${'ab'.repeat(16)}|${offerId(7)}`;

describe('offerSchema', () => {
  it('accepts an offer with exactly the SQL keys', () => {
    expect(Object.keys(makeOffer()).sort()).toEqual([...SQL_KEYS].sort());
    expect(offerSchema.safeParse(makeOffer()).success).toBe(true);
    expect(offerSchema.safeParse(makeOffer({ cover: COVER_JSON, type: 'homemade' })).success).toBe(
      true,
    );
  });

  it.each(SQL_KEYS)('refuses an offer missing %s', (key) => {
    const offer = makeOffer();
    delete offer[key];
    expect(offerSchema.safeParse(offer).success).toBe(false);
  });

  it.each(['owner_id', 'exact_lat', 'address', 'price_cents', 'status', 'promotion_id'])(
    'refuses an extra key %s (a private field must never be carried around)',
    (key) => {
      expect(offerSchema.safeParse(makeOffer({ [key]: 'x' })).success).toBe(false);
    },
  );

  it.each([
    ['band 3', { band: 3 }],
    ['band -1', { band: -1 }],
    ['an unknown type', { type: 'truck' }],
    ['an unknown category', { category: 'discount' }],
    ['an empty headline', { headline: '' }],
    ['a 61-character headline', { headline: 'x'.repeat(61) }],
    ['a latitude out of range', { lat: 91 }],
    ['a longitude out of range', { lng: -181 }],
    ['a business id that is not a uuid', { business_id: 'b1' }],
    ['an end time that is not a time', { ends_at: 'soon' }],
    ['a cover that is a gallery photo', { cover: { ...COVER_JSON, kind: 'gallery' } }],
    ['a cover with an extra key', { cover: { ...COVER_JSON, url: 'https://x' } }],
  ])('refuses %s', (_, overrides) => {
    expect(offerSchema.safeParse(makeOffer(overrides)).success).toBe(false);
  });

  it('accepts a headline of exactly 60 characters', () => {
    expect(offerSchema.safeParse(makeOffer({ headline: 'x'.repeat(60) })).success).toBe(true);
  });
});

describe('offersPageSchema', () => {
  const page = (offers: unknown[], next_cursor: string | null = null) => ({ offers, next_cursor });

  it('accepts an empty page, a last page and a page with a cursor', () => {
    expect(offersPageSchema.safeParse(page([])).success).toBe(true);
    expect(offersPageSchema.safeParse(page([makeOffer()])).success).toBe(true);
    expect(offersPageSchema.safeParse(page([makeOffer()], CURSOR)).success).toBe(true);
  });

  it('refuses more than 20 offers', () => {
    const offers = Array.from({ length: 21 }, (_, i) => makeOffer({ business_id: offerId(i + 1) }));
    expect(offersPageSchema.safeParse(page(offers)).success).toBe(false);
    expect(offersPageSchema.safeParse(page(offers.slice(0, 20))).success).toBe(true);
  });

  it.each([
    ['no band', `2026-11-20||${'ab'.repeat(16)}|${offerId(7)}`],
    ['band 3', `2026-11-20|3|${'ab'.repeat(16)}|${offerId(7)}`],
    ['upper-case hex', `2026-11-20|1|${'AB'.repeat(16)}|${offerId(7)}`],
    ['a short key', `2026-11-20|1|abc|${offerId(7)}`],
    ['no day', `|1|${'ab'.repeat(16)}|${offerId(7)}`],
    ['extra text', `${CURSOR}|x`],
  ])('refuses a cursor with %s', (_, cursor) => {
    expect(offersPageSchema.safeParse(page([], cursor)).success).toBe(false);
    expect(OFFER_CURSOR_PATTERN.test(cursor)).toBe(false);
  });

  it('refuses extra or missing top-level keys', () => {
    expect(offersPageSchema.safeParse({ offers: [] }).success).toBe(false);
    expect(offersPageSchema.safeParse({ ...page([]), total: 3 }).success).toBe(false);
  });
});

describe('the filters', () => {
  it('offer exactly the distances the server accepts, with About 15 km by default', () => {
    expect(OFFER_DISTANCES).toEqual([5, 15, 30]);
    expect(DEFAULT_OFFER_FILTERS).toEqual({
      distanceKm: 15,
      category: null,
      type: null,
      tables: false,
    });
  });
});
