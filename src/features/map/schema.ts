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
