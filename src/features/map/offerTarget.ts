import { z } from 'zod';

// Spec 16 Decision D15: an Offers card opens its place on the map tab with three route params:
// the business id and the place's public point (the shifted point for a home cook, which the map
// already shows to anyone). These are in-app route params only; nothing here is sent anywhere.
// Pure, so the map routes can be tested without a router.

export type OfferTarget = { business: string; lat: number; lng: number };

type Param = string | string[] | undefined;
export type OfferTargetParams = { business?: Param; lat?: Param; lng?: Param };

const single = (value: Param) => (typeof value === 'string' ? value : undefined);

const number = (min: number, max: number) =>
  z
    .string()
    .regex(/^-?\d+(\.\d+)?(e-?\d+)?$/)
    .transform(Number)
    .pipe(z.number().min(min).max(max));

const targetSchema = z.object({
  business: z.uuid(),
  lat: number(-90, 90),
  lng: number(-180, 180),
});

/** The target, or null when the params are missing or not a real place (they are then ignored). */
export function parseOfferTarget(params: OfferTargetParams): OfferTarget | null {
  const parsed = targetSchema.safeParse({
    business: single(params.business),
    lat: single(params.lat),
    lng: single(params.lng),
  });
  return parsed.success ? parsed.data : null;
}

/** The route params for one target (numbers as plain decimal text). */
export function offerTargetParams(target: OfferTarget): Record<'business' | 'lat' | 'lng', string> {
  return { business: target.business, lat: String(target.lat), lng: String(target.lng) };
}
