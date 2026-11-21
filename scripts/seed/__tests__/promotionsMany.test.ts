import {
  parseMany,
  planManyPromotions,
  planPromotions,
  promotionSeedOwners,
} from '../promotionsData';
import { assertSeedOwner } from '../safety';

const NOW = new Date('2026-11-20T23:30:00Z');
const DAY = 24 * 60 * 60 * 1000;
const many = planManyPromotions(NOW, 7);
const ms = (iso: string | null) => (iso === null ? NaN : Date.parse(iso));

describe('planManyPromotions (spec 16 PR 3 seed: more promoted places than the display limit)', () => {
  it('has 13 campaigns on 13 different businesses, at least 9 of them restaurants', () => {
    expect(many).toHaveLength(13);
    expect(new Set(many.map((p) => p.ownerUsername)).size).toBe(13);
    expect(
      many.filter((p) => p.ownerUsername.startsWith('seed_rest_')).length,
    ).toBeGreaterThanOrEqual(9);
    expect(many.filter((p) => p.ownerUsername.startsWith('seed_cook_'))).toHaveLength(2);
  });

  it('every campaign is approved and running now, for any length the settings allow', () => {
    for (const length of [1, 2, 7, 60]) {
      for (const row of planManyPromotions(NOW, length)) {
        expect(row.state).toBe('active');
        expect(row.status).toBe('approved');
        expect(ms(row.startsAt)).toBeLessThan(NOW.getTime());
        expect(ms(row.endsAt)).toBeGreaterThan(NOW.getTime());
        expect(ms(row.endsAt) - ms(row.startsAt)).toBe(length * DAY);
      }
    }
  });

  it('only uses demo owners the seed guard accepts, never the ones other demos use', () => {
    for (const row of many) {
      expect(() => assertSeedOwner(row.ownerUsername, row.ownerEmail)).not.toThrow();
      expect(['seed_rest_001', 'seed_rest_004', 'seed_rest_010', 'seed_cook_1']).not.toContain(
        row.ownerUsername,
      );
    }
  });

  it('pairs each username with the email of the same demo account', () => {
    for (const row of many) {
      const rest = /^seed_rest_(\d{3})$/.exec(row.ownerUsername);
      const cook = /^seed_cook_(\d+)$/.exec(row.ownerUsername);
      if (rest) expect(row.ownerEmail).toBe(`seed-restaurant-${rest[1]}@example.com`);
      else if (cook) expect(row.ownerEmail).toBe(`seed-homemade-${cook[1]}@example.com`);
      else throw new Error(`unexpected owner ${row.ownerUsername}`);
    }
  });

  it('headlines and categories pass the table rules, and no headline repeats', () => {
    for (const row of many) {
      expect(row.headline.length).toBeGreaterThanOrEqual(1);
      expect(row.headline.length).toBeLessThanOrEqual(60);
      expect(row.headline).toBe(row.headline.trim());
      expect(row.headline).toMatch(/^[\x20-\x7E]+$/);
      expect(['new_dish', 'special_offer', 'featured']).toContain(row.category);
    }
    expect(new Set(many.map((p) => p.headline)).size).toBe(13);
  });

  it('is the same for the same clock', () => {
    expect(planManyPromotions(NOW, 7)).toEqual(many);
  });
});

describe('promotionSeedOwners (what both modes clean first)', () => {
  it('covers every owner of the default seed and of --many, once each', () => {
    const owners = promotionSeedOwners(NOW, 7);
    const expected = new Set([...planPromotions(NOW, 7), ...many].map((p) => p.ownerUsername));
    expect(new Set(owners)).toEqual(expected);
    expect(owners).toHaveLength(expected.size);
  });
});

describe('parseMany', () => {
  it('is true only when --many is given', () => {
    expect(parseMany([])).toBe(false);
    expect(parseMany(['--extra'])).toBe(false);
    expect(parseMany(['--many'])).toBe(true);
    expect(parseMany(['--other', '--many'])).toBe(true);
  });
});
