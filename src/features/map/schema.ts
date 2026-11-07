import { z } from 'zod';

// What map_restaurants_in_bounds returns. Strict on purpose: an unexpected extra field (say a
// place_id or an address) means the server contract changed, and the app should refuse it rather
// than carry private data around.
export const MAX_PINS = 500;

export const pinSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  cuisine_code: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const pinsResponseSchema = z.strictObject({
  pins: z.array(pinSchema).max(MAX_PINS),
  capped: z.boolean(),
  too_large: z.boolean(),
});

export type Pin = z.output<typeof pinSchema>;
export type PinsResponse = z.output<typeof pinsResponseSchema>;

// get_restaurant_details: one restaurant, public fields only. Strict for the same reason as the
// pins: an unexpected extra field (exact coordinates, resolved_at, place_status) means the server
// contract changed, and the app refuses it. `null` (not in the schema) means "not available".
export const detailsPhotoSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['cover', 'gallery', 'menu', 'item']),
  path: z.string().min(1),
  position: z.number().int().nullable(),
  menu_item_id: z.string().nullable(),
});

export const detailsItemSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  price_minor: z.number().int().nullable(),
  is_available: z.boolean(),
  position: z.number().int(),
});

export const restaurantDetailsSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  cuisine_code: z.string().min(1),
  accepts_table_requests: z.boolean(),
  public_address: z.string().nullable(),
  place_id: z.string().min(1),
  currency_code: z.string().nullable(),
  photos: z.array(detailsPhotoSchema),
  items: z.array(detailsItemSchema),
});

export type DetailsPhoto = z.output<typeof detailsPhotoSchema>;
export type DetailsItem = z.output<typeof detailsItemSchema>;
export type RestaurantDetails = z.output<typeof restaurantDetailsSchema>;
