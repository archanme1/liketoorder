import { z } from 'zod';

import { charCount } from '@/features/food-log/text';

import { checkHeadline, MAX_HEADLINE_CHARS, type HeadlineProblem } from './text';

// The answers of get_my_promotion, request_promotion and cancel_my_promotion (spec 16): exactly
// the keys of private.promotion_json and get_my_promotion. An extra or missing key fails the parse,
// so the screen shows its error state instead of half-read data.

export const PROMOTION_CATEGORIES = ['new_dish', 'special_offer', 'featured'] as const;
export type PromotionCategory = (typeof PROMOTION_CATEGORIES)[number];

// Stored: requested, approved, rejected, cancelled. Scheduled, active and ended are the server
// clock's reading of an approved window (Decision D5).
export const PROMOTION_STATES = [
  'requested',
  'scheduled',
  'active',
  'ended',
  'rejected',
  'cancelled',
] as const;
export type PromotionState = (typeof PROMOTION_STATES)[number];

export const REJECT_REASONS = ['headline', 'not_paid', 'not_eligible', 'other'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

const WINDOW_STATES: readonly PromotionState[] = ['scheduled', 'active', 'ended'];

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)));
const priceCentsSchema = z.number().int().positive();
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const lengthDaysSchema = z.number().int().min(1).max(60);

export const promotionSettingsSchema = z.strictObject({
  price_cents: priceCentsSchema,
  currency_code: currencySchema,
  length_days: lengthDaysSchema,
});
export type PromotionSettings = z.infer<typeof promotionSettingsSchema>;

export const promotionSchema = z
  .strictObject({
    id: z.uuid(),
    category: z.enum(PROMOTION_CATEGORIES),
    headline: z
      .string()
      .refine((value) => charCount(value) >= 1 && charCount(value) <= MAX_HEADLINE_CHARS),
    preferred_start: dateSchema.nullable(),
    state: z.enum(PROMOTION_STATES),
    starts_at: timestampSchema.nullable(),
    ends_at: timestampSchema.nullable(),
    reject_reason: z.enum(REJECT_REASONS).nullable(),
    price_cents: priceCentsSchema,
    currency_code: currencySchema,
    length_days: lengthDaysSchema,
    created_at: timestampSchema,
  })
  .refine((p) => (p.starts_at === null) === (p.ends_at === null))
  .refine((p) => !WINDOW_STATES.includes(p.state) || p.starts_at !== null)
  .refine((p) => (p.state === 'rejected') === (p.reject_reason !== null));
export type Promotion = z.infer<typeof promotionSchema>;

export const myPromotionSchema = z.strictObject({
  promotion: promotionSchema.nullable(),
  settings: promotionSettingsSchema.nullable(),
  eligible: z.boolean(),
});
export type MyPromotion = z.infer<typeof myPromotionSchema>;

// -- The request form ----------------------------------------------------------------------
export const CATEGORY_REQUIRED = 'Choose a category.';
export const HEADLINE_MESSAGES: Record<HeadlineProblem, string> = {
  empty: 'Write a headline.',
  too_long: `Keep the headline to ${MAX_HEADLINE_CHARS} characters.`,
  hidden: 'The headline has a hidden or formatting character. Retype it without pasting.',
  joiner: "This emoji can't be used in a headline. Try a simpler one.",
  contact: "Don't add phone numbers or emails.",
};

// Fast feedback only: request_promotion judges.
export const promoteFormSchema = z.object({
  category: z
    .enum(PROMOTION_CATEGORIES, { error: CATEGORY_REQUIRED })
    .nullable()
    .refine((value) => value !== null, { message: CATEGORY_REQUIRED }),
  headline: z.string().superRefine((value, ctx) => {
    const check = checkHeadline(value);
    if (!check.ok) ctx.addIssue({ code: 'custom', message: HEADLINE_MESSAGES[check.code] });
  }),
  preferredStart: dateSchema.nullable(),
});
export type PromoteFormInput = z.input<typeof promoteFormSchema>;
