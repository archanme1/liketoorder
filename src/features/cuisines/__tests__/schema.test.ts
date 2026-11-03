import Ionicons from '@expo/vector-icons/Ionicons';

import { FALLBACK_CUISINE_ICON, cuisineRowsSchema, cuisineSchema } from '../schema';

const country = {
  code: 'IT',
  kind: 'country',
  name: 'Italy',
  flag: '🇮🇹',
  icon: null,
  sort_order: 100,
};

const neutral = {
  code: 'street-food',
  kind: 'neutral',
  name: 'Street food',
  flag: null,
  icon: 'fast-food-outline',
  sort_order: 900,
};

describe('cuisineSchema', () => {
  it('parses a valid country row', () => {
    const result = cuisineSchema.safeParse(country);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(country);
  });

  it('parses a valid neutral row', () => {
    const result = cuisineSchema.safeParse(neutral);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(neutral);
  });

  it('parses an array of rows', () => {
    expect(cuisineRowsSchema.safeParse([country, neutral]).success).toBe(true);
  });

  it('rejects a lower-case country code', () => {
    expect(cuisineSchema.safeParse({ ...country, code: 'it' }).success).toBe(false);
  });

  it('rejects a country with an icon', () => {
    expect(cuisineSchema.safeParse({ ...country, icon: 'fast-food-outline' }).success).toBe(false);
  });

  it('rejects a country with no flag (null)', () => {
    expect(cuisineSchema.safeParse({ ...country, flag: null }).success).toBe(false);
  });

  it('rejects a neutral row with a flag', () => {
    expect(cuisineSchema.safeParse({ ...neutral, flag: '🇮🇹' }).success).toBe(false);
  });

  it('rejects a neutral row with a null icon', () => {
    expect(cuisineSchema.safeParse({ ...neutral, icon: null }).success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(cuisineSchema.safeParse({ ...country, kind: 'region' }).success).toBe(false);
  });

  it('parses a neutral row with an unknown Ionicons name using the fallback icon', () => {
    const result = cuisineSchema.safeParse({ ...neutral, icon: 'not-a-real-icon-name' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.icon).toBe(FALLBACK_CUISINE_ICON);
  });

  it('keeps a known icon name unchanged', () => {
    const result = cuisineSchema.safeParse({ ...neutral, icon: 'shuffle-outline' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.icon).toBe('shuffle-outline');
  });
});

describe('icons', () => {
  it('FALLBACK_CUISINE_ICON is the Other icon', () => {
    expect(FALLBACK_CUISINE_ICON).toBe('ellipsis-horizontal-circle-outline');
  });

  it.each(['fast-food-outline', 'shuffle-outline', 'ellipsis-horizontal-circle-outline'])(
    'Ionicons.glyphMap contains the seeded icon %s',
    (name) => {
      const glyphMap = Ionicons.glyphMap as unknown as Record<string, number>;
      expect(Object.keys(glyphMap)).toContain(name);
    },
  );
});
