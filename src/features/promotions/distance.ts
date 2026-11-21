// Spec 16 Decision D12: how far an offer is, worked out on the phone. Pure.
//
// The distance runs from the real position (or the chosen area's centre) to the place's public point
// (the shifted point for a home cook). It is always worded as approximate, and a row is never hidden
// because of it: the server already chose the rows, and hiding one would break paging.

import type { OfferType } from './schema';

/** The mean earth radius the server uses (list_offers_near's c_earth_km). */
export const EARTH_RADIUS_KM = 6371.0088;

export type Origin = { latitude: number; longitude: number };
export type PublicPoint = { lat: number; lng: number };

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in km (haversine), the same formula as list_offers_near. */
export function distanceKm(from: Origin, to: PublicPoint): number {
  const dLat = toRadians(to.lat - from.latitude);
  const dLng = toRadians(to.lng - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * "Less than 1 km away", or "About N km away" rounded to whole km. A home cook adds ", approximate
 * area" (their public point is shifted). Null when the distance can't be worked out.
 */
export function distanceText(km: number, type: OfferType): string | null {
  if (!Number.isFinite(km) || km < 0) return null;
  const base = km < 1 ? 'Less than 1 km away' : `About ${Math.round(km)} km away`;
  return type === 'homemade' ? `${base}, approximate area` : base;
}
