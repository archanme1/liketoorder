import { myPromotionJson, promotionJson, SETTINGS_JSON } from '../__fixtures__/promotion';
import {
  CATEGORY_REQUIRED,
  HEADLINE_MESSAGES,
  myPromotionSchema,
  promoteFormSchema,
  promotionSchema,
  promotionSettingsSchema,
} from '../schema';

const STATES = ['requested', 'scheduled', 'active', 'ended', 'rejected', 'cancelled'] as const;

describe('myPromotionSchema: the answers the server gives', () => {
  it.each(STATES)('accepts a %s campaign exactly as the server builds it', (state) => {
    expect(myPromotionSchema.safeParse(myPromotionJson(promotionJson(state))).success).toBe(true);
  });

  it('accepts no campaign, no settings and not eligible (a business with nothing yet)', () => {
    const answer = myPromotionJson(null, { settings: null, eligible: false });
    expect(myPromotionSchema.parse(answer)).toEqual({
      promotion: null,
      settings: null,
      eligible: false,
    });
  });

  it('accepts a cancelled campaign that had been approved (it keeps its window)', () => {
    const json = promotionJson('cancelled', {
      starts_at: '2026-11-22T15:00:00.000Z',
      ends_at: '2026-11-29T15:00:00.000Z',
    });
    expect(promotionSchema.safeParse(json).success).toBe(true);
  });

  it('accepts the timestamp form Postgres writes into jsonb', () => {
    const json = promotionJson('active', {
      starts_at: '2026-11-17T15:00:00.123456+00:00',
      ends_at: '2026-11-24T15:00:00.123456+00:00',
      created_at: '2026-11-08T15:00:00.5+00:00',
    });
    expect(promotionSchema.safeParse(json).success).toBe(true);
  });

  it('accepts a 60-character headline with an emoji counted as one character', () => {
    const headline = 'a'.repeat(59) + String.fromCodePoint(0x1f35c);
    expect(promotionSchema.safeParse(promotionJson('requested', { headline })).success).toBe(true);
  });
});

describe('myPromotionSchema: refuses anything else', () => {
  it('refuses an extra key on the campaign', () => {
    const json = { ...promotionJson('active'), cancelled_by: 'admin' };
    expect(promotionSchema.safeParse(json).success).toBe(false);
  });

  it.each(Object.keys(promotionJson('active')))('refuses a campaign without %s', (key) => {
    const json: Record<string, unknown> = { ...promotionJson('active') };
    delete json[key];
    expect(promotionSchema.safeParse(json).success).toBe(false);
  });

  it('refuses an extra key at the top and on the settings', () => {
    expect(myPromotionSchema.safeParse({ ...myPromotionJson(null), owner_id: 'u1' }).success).toBe(
      false,
    );
    expect(promotionSettingsSchema.safeParse({ ...SETTINGS_JSON, id: true }).success).toBe(false);
  });

  it('refuses a missing top-level key', () => {
    const { eligible: _eligible, ...rest } = myPromotionJson(null);
    expect(myPromotionSchema.safeParse(rest).success).toBe(false);
  });

  it('refuses a stored status such as "approved" (only derived states come out)', () => {
    expect(promotionSchema.safeParse(promotionJson('active', { state: 'approved' })).success).toBe(
      false,
    );
  });

  it('refuses a reason on a campaign that is not rejected, and a rejection without one', () => {
    expect(
      promotionSchema.safeParse(promotionJson('cancelled', { reject_reason: 'other' })).success,
    ).toBe(false);
    expect(
      promotionSchema.safeParse(promotionJson('rejected', { reject_reason: null })).success,
    ).toBe(false);
    expect(
      promotionSchema.safeParse(promotionJson('rejected', { reject_reason: 'late' })).success,
    ).toBe(false);
  });

  it('refuses half a window, and a scheduled, active or ended campaign with none', () => {
    expect(promotionSchema.safeParse(promotionJson('active', { ends_at: null })).success).toBe(
      false,
    );
    for (const state of ['scheduled', 'active', 'ended'] as const) {
      const json = promotionJson(state, { starts_at: null, ends_at: null });
      expect(promotionSchema.safeParse(json).success).toBe(false);
    }
  });

  it('refuses an unknown category, a bad date, a bad timestamp and a bad currency', () => {
    for (const overrides of [
      { category: 'discount' },
      { preferred_start: '2026-12-2' },
      { created_at: 'yesterday' },
      { currency_code: 'cad' },
      { price_cents: 0 },
      { length_days: 61 },
      { id: 'not-a-uuid' },
      { headline: '' },
      { headline: 'a'.repeat(61) },
    ]) {
      expect(promotionSchema.safeParse(promotionJson('requested', overrides)).success).toBe(false);
    }
  });
});

describe('promoteFormSchema', () => {
  const valid = { category: 'featured', headline: 'Fresh tacos every day', preferredStart: null };

  it('accepts a full form, with or without a preferred day', () => {
    expect(promoteFormSchema.safeParse(valid).success).toBe(true);
    expect(promoteFormSchema.safeParse({ ...valid, preferredStart: '2026-11-21' }).success).toBe(
      true,
    );
  });

  it('asks for a category when none is chosen', () => {
    const result = promoteFormSchema.safeParse({ ...valid, category: null });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual([CATEGORY_REQUIRED]);
  });

  it('gives the headline message for each problem', () => {
    const message = (headline: string) =>
      promoteFormSchema.safeParse({ ...valid, headline }).error?.issues[0]?.message;
    expect(message('   ')).toBe(HEADLINE_MESSAGES.empty);
    expect(message('a'.repeat(61))).toBe(HEADLINE_MESSAGES.too_long);
    expect(message('Mail me at a@b.co')).toBe(HEADLINE_MESSAGES.contact);
    expect(message('Chef' + String.fromCodePoint(0x200d) + 'special')).toBe(
      HEADLINE_MESSAGES.joiner,
    );
  });
});

describe('myPromotionSchema: spec 16b states and keys (PR 1, accepted, not shown yet)', () => {
  it.each(['awaiting_payment', 'payment_expired', 'refunded'] as const)(
    'accepts a %s campaign exactly as the server builds it',
    (state) => {
      expect(myPromotionSchema.safeParse(myPromotionJson(promotionJson(state))).success).toBe(true);
    },
  );

  it('accepts a paid campaign (paid true, is_free false) in a window state', () => {
    for (const state of ['scheduled', 'active', 'ended'] as const) {
      const json = promotionJson(state, { paid: true, is_free: false });
      expect(promotionSchema.parse(json)).toMatchObject({ state, paid: true, is_free: false });
    }
  });

  it('keeps paid and is_free in the parsed campaign', () => {
    expect(promotionSchema.parse(promotionJson('scheduled'))).toMatchObject({
      paid: false,
      is_free: true,
    });
  });

  it.each(['paid', 'is_free'])('refuses %s when it is not a boolean', (key) => {
    for (const value of [null, 'true', 1]) {
      expect(promotionSchema.safeParse(promotionJson('active', { [key]: value })).success).toBe(
        false,
      );
    }
  });

  it('still refuses the stored names payment_due and approved (only derived states come out)', () => {
    for (const state of ['payment_due', 'approved']) {
      expect(promotionSchema.safeParse(promotionJson('requested', { state })).success).toBe(false);
    }
  });
});
