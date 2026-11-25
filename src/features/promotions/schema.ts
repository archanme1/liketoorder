import { z } from 'zod';

import { charCount } from '@/features/food-log/text';
import { detailsPhotoSchema } from '@/features/map/schema';

import { checkHeadline, MAX_HEADLINE_CHARS, type HeadlineProblem } from './text';

// The answers of get_my_promotion, request_promotion and cancel_my_promotion (spec 16): exactly
// the keys of private.promotion_json and get_my_promotion. An extra or missing key fails the parse,
// so the screen shows its error state instead of half-read data. The one exception: the two price
// keys of a server from before spec 16b D15 are dropped before the parse (see below).

export const PROMOTION_CATEGORIES = ['new_dish', 'special_offer', 'featured'] as const;
export type PromotionCategory = (typeof PROMOTION_CATEGORIES)[number];

// Stored: requested, payment_due, approved, rejected, cancelled, payment_expired, refunded.
// Scheduled, active and ended are the server clock's reading of an approved window (Decision D5);
// awaiting_payment and payment_expired are its reading of a payment_due row (spec 16b).
export const PROMOTION_STATES = [
  'requested',
  'awaiting_payment',
  'scheduled',
  'active',
  'ended',
  'rejected',
  'cancelled',
  'payment_expired',
  'refunded',
] as const;
export type PromotionState = (typeof PROMOTION_STATES)[number];

export const REJECT_REASONS = ['headline', 'not_paid', 'not_eligible', 'other'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

const WINDOW_STATES: readonly PromotionState[] = ['scheduled', 'active', 'ended'];

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)));
const lengthDaysSchema = z.number().int().min(1).max(60);

/**
 * Spec 16b D15: the app never reads a promotion price. A server from before the D15 migration still
 * sends these two keys; they are dropped here, before the strict parse, so that server does not break
 * this app and the parsed data has no price for any screen to show. Any other unknown key still fails.
 */
export const LEGACY_PRICE_KEYS = ['price_cents', 'currency_code'] as const;

function withoutLegacyPriceKeys(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of LEGACY_PRICE_KEYS) delete copy[key];
  return copy;
}

export const promotionSettingsSchema = z.preprocess(
  withoutLegacyPriceKeys,
  z.strictObject({
    length_days: lengthDaysSchema,
  }),
);
export type PromotionSettings = z.infer<typeof promotionSettingsSchema>;

export const promotionSchema = z.preprocess(
  withoutLegacyPriceKeys,
  z
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
      length_days: lengthDaysSchema,
      // Spec 16b: paid, as the server recorded it ("Paid and scheduled"), or a free campaign
      // approved by hand (it keeps its cancel button). Defaults let this app read a server from
      // before spec 16b; the hosted migrations ship only together with this app, never before it.
      paid: z.boolean().default(false),
      is_free: z.boolean().default(false),
      created_at: timestampSchema,
    })
    .refine((p) => (p.starts_at === null) === (p.ends_at === null))
    .refine((p) => !WINDOW_STATES.includes(p.state) || p.starts_at !== null)
    .refine((p) => (p.state === 'rejected') === (p.reject_reason !== null)),
);
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

// -- Offers (spec 16 PR 4): the answer of list_offers_near ---------------------------------
// Exactly the keys of the offer objects built in 20261120214854_promotions.sql. Strict like the map
// schemas: an extra key (an owner, an exact point, a price, a status) means the server contract
// changed, and the whole page is refused.

export const OFFER_TYPES = ['restaurant', 'homemade'] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

/** The server accepts exactly these (about 5, 15 or 30 km). */
export const OFFER_DISTANCES = [5, 15, 30] as const;
export type OfferDistance = (typeof OFFER_DISTANCES)[number];
export const DEFAULT_OFFER_DISTANCE: OfferDistance = 15;

/** list_offers_near's c_page. The server enforces it; the app never sends a size. */
export const OFFERS_PAGE_SIZE = 20;

/** The cursor list_offers_near builds and accepts: day | band | rotation key | business id. */
export const OFFER_CURSOR_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-2]\|[0-9a-f]{32}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The business's cover photo: the same five keys as a details photo, and always a cover. */
export const offerCoverSchema = detailsPhotoSchema.refine((photo) => photo.kind === 'cover');

export const offerSchema = z.strictObject({
  business_id: z.uuid(),
  type: z.enum(OFFER_TYPES),
  name: z.string().min(1),
  cuisine_code: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accepts_table_requests: z.boolean(),
  category: z.enum(PROMOTION_CATEGORIES),
  headline: z
    .string()
    .refine((value) => charCount(value) >= 1 && charCount(value) <= MAX_HEADLINE_CHARS),
  ends_at: timestampSchema,
  band: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  cover: offerCoverSchema.nullable(),
});
export type Offer = z.infer<typeof offerSchema>;

export const offersPageSchema = z.strictObject({
  offers: z.array(offerSchema).max(OFFERS_PAGE_SIZE),
  next_cursor: z.string().regex(OFFER_CURSOR_PATTERN).nullable(),
});
export type OffersPage = z.infer<typeof offersPageSchema>;

/** The list's filters. Null means All; `tables` false means any place. */
export type OfferFilters = {
  distanceKm: OfferDistance;
  category: PromotionCategory | null;
  type: OfferType | null;
  tables: boolean;
};

export const DEFAULT_OFFER_FILTERS: OfferFilters = {
  distanceKm: DEFAULT_OFFER_DISTANCE,
  category: null,
  type: null,
  tables: false,
};
