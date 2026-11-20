import { planPromotions } from '../promotionsData';
import { assertSeedOwner } from '../safety';

const NOW = new Date('2026-11-20T23:30:00Z');
const DAY = 24 * 60 * 60 * 1000;
const plan = planPromotions(NOW, 7);
const byState = (state: string) => {
  const row = plan.find((p) => p.state === state);
  if (!row) throw new Error(`no ${state} row`);
  return row;
};
const ms = (iso: string | null) => (iso === null ? NaN : Date.parse(iso));

describe('planPromotions (spec 16 seed campaigns)', () => {
  it('has exactly one campaign in each of the four states, on four different restaurants', () => {
    expect(plan.map((p) => p.state).sort()).toEqual(['active', 'ended', 'requested', 'scheduled']);
    expect(new Set(plan.map((p) => p.ownerUsername)).size).toBe(4);
  });

  it('only uses demo owners the seed guard accepts, never the ones other demos use', () => {
    for (const row of plan) {
      expect(() => assertSeedOwner(row.ownerUsername, row.ownerEmail)).not.toThrow();
      expect(['seed_rest_001', 'seed_rest_004', 'seed_rest_010']).not.toContain(row.ownerUsername);
    }
  });

  it('active runs now, scheduled starts later, ended is over (by the clock it is given)', () => {
    const active = byState('active');
    expect(ms(active.startsAt)).toBeLessThanOrEqual(NOW.getTime());
    expect(ms(active.endsAt)).toBeGreaterThan(NOW.getTime());
    expect(ms(byState('scheduled').startsAt)).toBeGreaterThan(NOW.getTime());
    expect(ms(byState('ended').endsAt)).toBeLessThanOrEqual(NOW.getTime());
  });

  it('every approved window is exactly the settings length, and approved rows have one', () => {
    for (const row of plan.filter((p) => p.status === 'approved')) {
      expect(ms(row.endsAt) - ms(row.startsAt)).toBe(7 * DAY);
    }
    expect(
      planPromotions(NOW, 3)
        .filter((p) => p.status === 'approved')
        .map((p) => ms(p.endsAt) - ms(p.startsAt)),
    ).toEqual([3 * DAY, 3 * DAY, 3 * DAY]);
  });

  it('the active campaign is running now even when campaigns last only 1 day', () => {
    for (const length of [1, 2, 7, 60]) {
      const active = planPromotions(NOW, length).find((p) => p.state === 'active');
      expect(ms(active?.startsAt ?? null)).toBeLessThan(NOW.getTime());
      expect(ms(active?.endsAt ?? null)).toBeGreaterThan(NOW.getTime());
    }
  });

  it('the request has no window and a preferred start the server accepts', () => {
    const requested = byState('requested');
    expect(requested.status).toBe('requested');
    expect(requested.startsAt).toBeNull();
    expect(requested.endsAt).toBeNull();
    // request_promotion allows the UTC date minus 1 day up to plus 90 days.
    const start = Date.parse(`${requested.preferredStart}T00:00:00Z`);
    const today = Date.parse(`${NOW.toISOString().slice(0, 10)}T00:00:00Z`);
    expect(start).toBeGreaterThanOrEqual(today - DAY);
    expect(start).toBeLessThanOrEqual(today + 90 * DAY);
  });

  it('headlines and categories pass the table rules', () => {
    for (const row of plan) {
      expect(row.headline.length).toBeGreaterThanOrEqual(1);
      expect(row.headline.length).toBeLessThanOrEqual(60);
      expect(row.headline).toBe(row.headline.trim());
      expect(row.headline).toMatch(/^[\x20-\x7E]+$/);
      expect(['new_dish', 'special_offer', 'featured']).toContain(row.category);
    }
  });

  it('is the same for the same clock', () => {
    expect(planPromotions(NOW, 7)).toEqual(plan);
  });
});
