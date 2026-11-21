// Spec 16 Offers: the area the list uses when the person's own position is not used, and how the
// screen words it. Pure.

import { isValidRegion, type MapRegion } from '@/features/map/region';

import { LAUNCH_AREA } from './launchArea';

/** A saved map view wider than this (degrees, either side) is a country or world view: skipped. */
export const MAX_FALLBACK_SPAN_DEGREES = 1;

export type AreaSource = 'last_map' | 'launch';

export type FallbackArea = { source: AreaSource; latitude: number; longitude: number };

function usable(region: MapRegion | null): region is MapRegion {
  return (
    region !== null &&
    isValidRegion(region) &&
    region.latitudeDelta <= MAX_FALLBACK_SPAN_DEGREES &&
    region.longitudeDelta <= MAX_FALLBACK_SPAN_DEGREES
  );
}

/**
 * The centre of the last Restaurants map view, else of the last Homemade view, else the launch area.
 * The saved views are only read here, never written.
 */
export function fallbackArea(
  lastRestaurants: MapRegion | null,
  lastHomemade: MapRegion | null,
): FallbackArea {
  const region = usable(lastRestaurants)
    ? lastRestaurants
    : usable(lastHomemade)
      ? lastHomemade
      : null;
  if (region) return { source: 'last_map', latitude: region.latitude, longitude: region.longitude };
  return { source: 'launch', latitude: LAUNCH_AREA.latitude, longitude: LAUNCH_AREA.longitude };
}

/** Where the list is looking: the person's own position, or an area. */
export type OriginKind = 'me' | AreaSource;

/** "the area you last viewed on the map" or "Oshawa". */
export function areaName(source: AreaSource): string {
  return source === 'last_map' ? 'the area you last viewed on the map' : LAUNCH_AREA.name;
}

/** The line above the filters. */
export function areaHeading(kind: OriginKind): string {
  return kind === 'me' ? 'Near you' : `Near ${areaName(kind)}`;
}

/**
 * Why the person's own position is not in use:
 * - location_off: denied, denied for ever, or Location Services off (only these say "off");
 * - not_asked: never asked yet, or the note was dismissed with "Not now";
 * - no_fix: allowed, but no position came in time.
 */
export type AreaReason = 'location_off' | 'not_asked' | 'no_fix';

/** The notice shown while the list uses an area. Never says "Location is off" unless it is. */
export function areaNotice(reason: AreaReason, source: AreaSource): string {
  const near = `Showing offers near ${areaName(source)}.`;
  if (reason === 'location_off') return `Location is off. ${near}`;
  if (reason === 'no_fix') return `We couldn't find your location. ${near}`;
  return near;
}
