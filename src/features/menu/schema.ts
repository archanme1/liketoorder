import { z } from 'zod';

import { parsePrice, PRICE_ERROR_MESSAGE } from './price';

// Must match the check constraints in supabase/migrations/20261104035153_menu_management.sql
// and the limits in the menu functions (Decision 17).
export const ITEM_NAME_MAX = 80;
export const ITEM_DESCRIPTION_MAX = 300;
export const ITEM_LIMIT = 100;
export const GALLERY_LIMIT = 6;
export const MENU_PHOTO_LIMIT = 10;

const NAME_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// Newlines are allowed in descriptions (the DB check excludes only \n from the control range).
const DESCRIPTION_CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f]/;

export const currencySchema = z.object({
  code: z.string(),
  name: z.string(),
  minor_units: z.number().int(),
});
export type Currency = z.infer<typeof currencySchema>;

export const menuItemSchema = z.object({
  id: z.string(),
  business_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  price_minor: z.number().int().nullable(),
  is_available: z.boolean(),
  position: z.number().int(),
});
export type MenuItem = z.infer<typeof menuItemSchema>;

export const photoKindSchema = z.enum(['cover', 'gallery', 'menu', 'item']);
export type PhotoKind = z.infer<typeof photoKindSchema>;

export const businessPhotoSchema = z.object({
  id: z.string(),
  business_id: z.string(),
  kind: photoKindSchema,
  menu_item_id: z.string().nullable(),
  path: z.string(),
  position: z.number().int().nullable(),
});
export type BusinessPhoto = z.infer<typeof businessPhotoSchema>;

/** begin_photo_upload() → the server-made reservation. */
export const photoReservationSchema = z.object({ photo_id: z.string(), path: z.string() });
export type PhotoReservation = z.infer<typeof photoReservationSchema>;

export type Menu = { items: MenuItem[]; photos: BusinessPhoto[] };

/**
 * The item form. The price is text, parsed per currency at submit time: `minorUnits` is the
 * currency's decimals, or null when no currency is chosen yet (then any price is checked once the
 * seller picks one, via `currency_code`).
 */
export function itemFormSchema(minorUnitsFor: (code: string | null) => number | null) {
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Enter the item name')
        .max(ITEM_NAME_MAX, `Use ${ITEM_NAME_MAX} characters or fewer`)
        .refine((value) => !NAME_CONTROL_CHARS.test(value), 'Remove special characters'),
      description: z
        .string()
        .trim()
        .max(ITEM_DESCRIPTION_MAX, `Use ${ITEM_DESCRIPTION_MAX} characters or fewer`)
        .refine((value) => !DESCRIPTION_CONTROL_CHARS.test(value), 'Remove special characters')
        .transform((value) => (value === '' ? null : value)),
      price: z.string(),
      currency_code: z.string().nullable(),
      is_available: z.boolean(),
    })
    .transform((values, ctx) => {
      const text = values.price.trim();
      if (text === '') return { ...values, price_minor: null };
      const minorUnits = minorUnitsFor(values.currency_code);
      if (minorUnits === null) {
        ctx.addIssue({ code: 'custom', path: ['currency_code'], message: 'Choose a currency' });
        return z.NEVER;
      }
      const parsed = parsePrice(text, minorUnits);
      if (!parsed.ok) {
        ctx.addIssue({
          code: 'custom',
          path: ['price'],
          message: PRICE_ERROR_MESSAGE[parsed.error](minorUnits),
        });
        return z.NEVER;
      }
      return { ...values, price_minor: parsed.minor };
    });
}

export type ItemFormInput = z.input<ReturnType<typeof itemFormSchema>>;
export type ItemFormValues = z.output<ReturnType<typeof itemFormSchema>>;
