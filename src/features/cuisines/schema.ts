import Ionicons from '@expo/vector-icons/Ionicons';
import { z } from 'zod';

// Must match the check constraints on public.cuisines
// (supabase/migrations/20261103040302_cuisine_catalog.sql).
const COUNTRY_CODE = /^[A-Z]{2}$/;
const NEUTRAL_CODE = /^[a-z]+(-[a-z]+)*$/;

export type CuisineIconName = keyof typeof Ionicons.glyphMap;

/** Shown when a stored icon name isn't in the installed Ionicons set (e.g. after a package upgrade). */
export const FALLBACK_CUISINE_ICON: CuisineIconName = 'ellipsis-horizontal-circle-outline';

function isIconName(name: string): name is CuisineIconName {
  return Object.prototype.hasOwnProperty.call(Ionicons.glyphMap, name);
}

const countrySchema = z.object({
  kind: z.literal('country'),
  code: z.string().regex(COUNTRY_CODE),
  name: z.string().min(1),
  flag: z.string().min(1),
  icon: z.null(),
  sort_order: z.number().int(),
});

const neutralSchema = z.object({
  kind: z.literal('neutral'),
  code: z.string().regex(NEUTRAL_CODE),
  name: z.string().min(1),
  flag: z.null(),
  icon: z
    .string()
    .min(1)
    .transform((name): CuisineIconName => (isIconName(name) ? name : FALLBACK_CUISINE_ICON)),
  sort_order: z.number().int(),
});

export const cuisineSchema = z.discriminatedUnion('kind', [countrySchema, neutralSchema]);
export const cuisineRowsSchema = z.array(cuisineSchema);

export type CountryCuisine = z.output<typeof countrySchema>;
export type NeutralCuisine = z.output<typeof neutralSchema>;
export type Cuisine = z.output<typeof cuisineSchema>;
