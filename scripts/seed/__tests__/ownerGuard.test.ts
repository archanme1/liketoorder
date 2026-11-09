import { assertSeedOwner } from '../safety';

describe('assertSeedOwner (the seed may only delete requests a seed owner sent)', () => {
  it('allows a demo restaurant or cook with a seed email', () => {
    expect(() => assertSeedOwner('seed_rest_001', 'seed-restaurant-001@example.com')).not.toThrow();
    expect(() => assertSeedOwner('seed_cook_1', 'seed-homemade-1@example.com')).not.toThrow();
  });

  it('refuses a real account that holds a demo username', () => {
    expect(() => assertSeedOwner('seed_rest_001', 'archan@gmail.com')).toThrow(/non-seed/);
    expect(() => assertSeedOwner('seed_rest_001', 'seed-restaurant-001@example.org')).toThrow(
      /non-seed/,
    );
  });

  it('refuses an account with no email', () => {
    expect(() => assertSeedOwner('seed_rest_001', undefined)).toThrow(/non-seed/);
    expect(() => assertSeedOwner('seed_rest_001', null)).toThrow(/non-seed/);
  });

  it('refuses a username that is not a demo one, even with a seed email', () => {
    expect(() => assertSeedOwner('archan', 'seed-restaurant-001@example.com')).toThrow(/non-seed/);
    expect(() => assertSeedOwner('seed_rest_1', 'seed-restaurant-001@example.com')).toThrow(
      /non-seed/,
    );
  });
});
