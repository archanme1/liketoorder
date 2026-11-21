import {
  parseSeedMode,
  planForMode,
  planManyPromotions,
  planOffersPromotions,
  planPromotions,
  promotionSeedOwners,
} from '../promotionsData';
import { assertSeedOwner } from '../safety';

// --offers (spec 16 PR 4): enough campaigns near Oshawa for a second Offers page.
//
// Which page sizes you see in the Simulator depend on the chosen distance, measured by the server
// from the Oshawa grid point (43.9, -78.85) plus its 4 km margin:
// - "About 30 km" (34 km) reaches all 22, so the list shows 20, then a second page of 2.
// - "About 15 km" (19 km) reaches 20 (Pickering, 043, at 20 km and Scarborough, 040, at 34 km are
//   outside), so it shows exactly one full page and no second one.
// - "About 5 km" (9 km) reaches the Oshawa places and Whitby only.

const NOW = new Date('2026-11-21T18:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const offers = planOffersPromotions(NOW, 7);
const ms = (iso: string | null) => (iso === null ? NaN : Date.parse(iso));

describe('planOffersPromotions', () => {
  it('has 22 campaigns on 22 different businesses: more than one page of 20', () => {
    expect(offers).toHaveLength(22);
    expect(offers.length).toBeGreaterThan(20);
    expect(new Set(offers.map((p) => p.ownerUsername)).size).toBe(22);
    expect(offers.filter((p) => p.ownerUsername.startsWith('seed_rest_'))).toHaveLength(17);
    expect(offers.filter((p) => p.ownerUsername.startsWith('seed_cook_'))).toHaveLength(5);
  });

  it('leaves seed_rest_001 out (the Promote invitation) and includes 004, 010 and cook 1', () => {
    const owners = offers.map((p) => p.ownerUsername);
    expect(owners).not.toContain('seed_rest_001');
    expect(owners).toEqual(
      expect.arrayContaining(['seed_rest_004', 'seed_rest_010', 'seed_cook_1']),
    );
  });

  it('only uses Oshawa-area places within About 30 km', () => {
    const owners = offers.map((p) => p.ownerUsername);
    for (let n = 2; n <= 14; n += 1) {
      expect(owners).toContain(`seed_rest_${String(n).padStart(3, '0')}`);
    }
    for (const nearby of ['040', '043', '044', '045'])
      expect(owners).toContain(`seed_rest_${nearby}`);
    for (let n = 1; n <= 5; n += 1) expect(owners).toContain(`seed_cook_${n}`);
  });

  it('every campaign is approved and running now, for any length the settings allow', () => {
    for (const length of [1, 2, 7, 60]) {
      for (const row of planOffersPromotions(NOW, length)) {
        expect(row.state).toBe('active');
        expect(row.status).toBe('approved');
        expect(row.preferredStart).toBeNull();
        expect(ms(row.startsAt)).toBeLessThan(NOW.getTime());
        expect(ms(row.endsAt)).toBeGreaterThan(NOW.getTime());
        expect(ms(row.endsAt) - ms(row.startsAt)).toBe(length * DAY);
      }
    }
  });

  it('only uses owners the seed guard accepts, each with its own email', () => {
    for (const row of offers) {
      expect(() => assertSeedOwner(row.ownerUsername, row.ownerEmail)).not.toThrow();
      const rest = /^seed_rest_(\d{3})$/.exec(row.ownerUsername);
      const cook = /^seed_cook_(\d+)$/.exec(row.ownerUsername);
      if (rest) expect(row.ownerEmail).toBe(`seed-restaurant-${rest[1]}@example.com`);
      else if (cook) expect(row.ownerEmail).toBe(`seed-homemade-${cook[1]}@example.com`);
      else throw new Error(`unexpected owner ${row.ownerUsername}`);
    }
  });

  it('headlines and categories pass the table rules, and no headline repeats', () => {
    for (const row of offers) {
      expect(row.headline.length).toBeGreaterThanOrEqual(1);
      expect(row.headline.length).toBeLessThanOrEqual(60);
      expect(row.headline).toBe(row.headline.trim());
      expect(row.headline).toMatch(/^[\x20-\x7E]+$/);
      expect(['new_dish', 'special_offer', 'featured']).toContain(row.category);
    }
    expect(new Set(offers.map((p) => p.headline)).size).toBe(22);
    for (const category of ['new_dish', 'special_offer', 'featured']) {
      expect(offers.some((p) => p.category === category)).toBe(true);
    }
  });
});

describe('parseSeedMode', () => {
  it('picks the mode from the flag', () => {
    expect(parseSeedMode([])).toBe('default');
    expect(parseSeedMode(['--many'])).toBe('many');
    expect(parseSeedMode(['--offers'])).toBe('offers');
  });

  it('refuses any other argument, and both flags together', () => {
    expect(() => parseSeedMode(['--ofers'])).toThrow(
      'Unknown argument --ofers. The only options are --many and --offers.',
    );
    expect(() => parseSeedMode(['--offers', '--x'])).toThrow(/Unknown argument --x/);
    expect(() => parseSeedMode(['--many', '--offers'])).toThrow(
      'Use --many or --offers, not both.',
    );
  });
});

describe('planForMode and the cleanup list', () => {
  it('writes the plan of the chosen mode', () => {
    expect(planForMode('default', NOW, 7)).toEqual(planPromotions(NOW, 7));
    expect(planForMode('many', NOW, 7)).toEqual(planManyPromotions(NOW, 7));
    expect(planForMode('offers', NOW, 7)).toEqual(offers);
  });

  it('cleans every owner any mode touches, so switching modes leaves nothing behind', () => {
    const owners = new Set(promotionSeedOwners(NOW, 7));
    for (const plan of [...planPromotions(NOW, 7), ...planManyPromotions(NOW, 7), ...offers]) {
      expect(owners.has(plan.ownerUsername)).toBe(true);
    }
    expect(owners.has('seed_rest_001')).toBe(false);
  });
});
