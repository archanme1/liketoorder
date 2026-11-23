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

describe('planPromotions (spec 16 and 16b seed campaigns)', () => {
  it('has exactly one campaign in each of the six states, on six different restaurants', () => {
    expect(plan.map((p) => p.state).sort()).toEqual([
      'active',
      'ended',
      'paid_scheduled',
      'payment_due',
      'requested',
      'scheduled',
    ]);
    expect(new Set(plan.map((p) => p.ownerUsername)).size).toBe(6);
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
    ).toEqual([3 * DAY, 3 * DAY, 3 * DAY, 3 * DAY]);
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

describe('planPromotions: spec 16b payment demos', () => {
  const FAKE = { customer: /^cus_FakeSeed[0-9]{4}$/, invoice: /^in_FakeSeed[0-9]{4}$/ };

  it('the spec 16 demos are free (approved by hand), the request is not, and none has a payment', () => {
    for (const state of ['active', 'scheduled', 'ended'] as const) {
      expect(byState(state)).toMatchObject({
        isFree: true,
        payBy: null,
        paidAt: null,
        payment: null,
      });
    }
    expect(byState('requested')).toMatchObject({ isFree: false, payment: null });
  });

  it('payment_due goes to seed_rest_007, with a 7-day window and an open fake invoice', () => {
    const due = byState('payment_due');
    expect(due.ownerUsername).toBe('seed_rest_007');
    expect(due).toMatchObject({ status: 'payment_due', isFree: false, paidAt: null });
    expect(due.startsAt).toBeNull();
    expect(ms(due.payBy)).toBe(NOW.getTime() + 7 * DAY);
    expect(due.payment).toEqual({
      status: 'open',
      customerId: 'cus_FakeSeed0001',
      invoiceId: 'in_FakeSeed0001',
      paymentIntentId: null,
    });
  });

  it('the paid demo goes to seed_rest_008: approved, not free, paid before now, scheduled later', () => {
    const paid = byState('paid_scheduled');
    expect(paid.ownerUsername).toBe('seed_rest_008');
    expect(paid).toMatchObject({ status: 'approved', isFree: false, payBy: null });
    expect(ms(paid.paidAt)).toBeLessThan(NOW.getTime());
    expect(ms(paid.startsAt)).toBeGreaterThan(NOW.getTime());
    expect(paid.payment).toEqual({
      status: 'paid',
      customerId: 'cus_FakeSeed0002',
      invoiceId: 'in_FakeSeed0002',
      paymentIntentId: 'pi_FakeSeed0002',
    });
  });

  it('every fake id matches the table checks and is used once', () => {
    const payments = plan.flatMap((p) => (p.payment ? [p.payment] : []));
    expect(payments).toHaveLength(2);
    for (const payment of payments) {
      expect(payment.customerId).toMatch(FAKE.customer);
      expect(payment.invoiceId).toMatch(FAKE.invoice);
      // The same patterns as promotion_payments' checks: no underscore after the prefix's own.
      expect(payment.customerId).toMatch(/^cus_[A-Za-z0-9]+$/);
      expect(payment.invoiceId).toMatch(/^in_[A-Za-z0-9]+$/);
      if (payment.paymentIntentId !== null) {
        expect(payment.paymentIntentId).toMatch(/^pi_[A-Za-z0-9]+$/);
      }
    }
    const ids = payments.flatMap((p) => [p.customerId, p.invoiceId]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
