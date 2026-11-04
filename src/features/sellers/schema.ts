import { z } from 'zod';

// Must match the check constraints on public.businesses
// (supabase/migrations/20261103215641_seller_onboarding.sql).
export const BUSINESS_NAME_MAX = 60;
export const PLACES_INPUT_MIN = 3;
export const PLACES_INPUT_MAX = 120;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export const businessTypeSchema = z.enum(['restaurant', 'homemade'], {
  error: 'Choose Restaurant or Homemade',
});
export type BusinessType = z.infer<typeof businessTypeSchema>;

export const businessNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter your business name')
  .max(BUSINESS_NAME_MAX, `Use ${BUSINESS_NAME_MAX} characters or fewer`)
  .refine((value) => !CONTROL_CHARS.test(value), 'Remove special characters');

const cuisineCodeSchema = z.string().min(1, 'Pick a cuisine');

// Table requests are a restaurant feature; the DB rejects them for homemade (23514), so the form
// never sends true for homemade.
export const onboardingFormSchema = z
  .object({
    type: businessTypeSchema,
    name: businessNameSchema,
    cuisine_code: cuisineCodeSchema,
    accepts_table_requests: z.boolean(),
  })
  .transform((values) => ({
    ...values,
    accepts_table_requests: values.type === 'restaurant' && values.accepts_table_requests,
  }));

export type OnboardingFormInput = z.input<typeof onboardingFormSchema>;
export type OnboardingFormValues = z.output<typeof onboardingFormSchema>;

// Type is fixed after creation (spec 05 Decision 11), so it is not part of the edit form.
export const editFormSchema = z.object({
  name: businessNameSchema,
  cuisine_code: cuisineCodeSchema,
  accepts_table_requests: z.boolean(),
});

export type EditFormValues = z.infer<typeof editFormSchema>;

/** The owner view returned by get_my_business() and places-resolve. */
export const myBusinessSchema = z.object({
  id: z.string(),
  type: businessTypeSchema,
  name: z.string(),
  cuisine_code: z.string(),
  accepts_table_requests: z.boolean(),
  map_lat: z.number().nullable(),
  map_lng: z.number().nullable(),
  public_address: z.string().nullable(),
  is_listed: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  location: z
    .object({ formatted_address: z.string(), lat: z.number(), lng: z.number() })
    .nullable(),
});

export type MyBusiness = z.infer<typeof myBusinessSchema>;

export const placeSuggestionSchema = z.object({
  placeId: z.string(),
  primaryText: z.string(),
  secondaryText: z.string(),
});

export type PlaceSuggestion = z.infer<typeof placeSuggestionSchema>;

export const placeSuggestionsResponseSchema = z.object({
  suggestions: z.array(placeSuggestionSchema),
});
