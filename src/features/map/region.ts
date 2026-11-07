// Pure map geometry. No React Native imports, so it is cheap to test.

export type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/** The visible area, as sent to the server. The only location data the app ever sends. */
export type MapBox = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

/** The server answers `too_large` above this span (degrees), so the app never asks. */
export const MAX_SPAN_DEGREES = 90;

/** Neighbourhood zoom used when the map centres on the person. */
export const NEIGHBOURHOOD_DELTA = 0.02;

/** A plain world view: wider than MAX_SPAN_DEGREES, so it never requests pins. */
export const WORLD_REGION: MapRegion = {
  latitude: 20,
  longitude: 0,
  latitudeDelta: 120,
  longitudeDelta: 120,
};

export function isValidRegion(value: unknown): value is MapRegion {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  return (
    finite(r.latitude) &&
    finite(r.longitude) &&
    finite(r.latitudeDelta) &&
    finite(r.longitudeDelta) &&
    r.latitude >= -90 &&
    r.latitude <= 90 &&
    r.longitude >= -180 &&
    r.longitude <= 180 &&
    r.latitudeDelta > 0 &&
    r.longitudeDelta > 0
  );
}

/** True when the view is wider than the server accepts: show "Zoom in", send no request. */
export function isOverServerLimit(region: MapRegion): boolean {
  return region.latitudeDelta > MAX_SPAN_DEGREES || region.longitudeDelta > MAX_SPAN_DEGREES;
}

export function regionToBox(region: MapRegion): MapBox {
  const halfLat = region.latitudeDelta / 2;
  const halfLng = region.longitudeDelta / 2;
  return {
    minLat: region.latitude - halfLat,
    maxLat: region.latitude + halfLat,
    minLng: region.longitude - halfLng,
    maxLng: region.longitude + halfLng,
  };
}

export function regionAround(latitude: number, longitude: number): MapRegion {
  return {
    latitude,
    longitude,
    latitudeDelta: NEIGHBOURHOOD_DELTA,
    longitudeDelta: NEIGHBOURHOOD_DELTA,
  };
}

/** Rounds a box to ~100 m (3 decimals) so tiny pans share one cache entry and one request. */
export function roundBox(box: MapBox, decimals = 3): MapBox {
  const factor = 10 ** decimals;
  const round = (n: number) => Math.round(n * factor) / factor;
  return {
    minLat: round(box.minLat),
    maxLat: round(box.maxLat),
    minLng: round(box.minLng),
    maxLng: round(box.maxLng),
  };
}

/** A pick from the list keeps the person's zoom if they are already this close (degrees). */
export const PICK_MAX_DELTA = 0.05;

/** Share of the view height the sheet's half snap takes from the top of the pin's centre. */
const SHEET_OFFSET = 0.25;

/**
 * Where the camera goes when a restaurant is picked from the "Places in this area" list: a short
 * move that puts the pin in the middle of the part of the map the half-open sheet leaves
 * uncovered (the upper half), at neighbourhood zoom. A view that is already closer than that
 * keeps its zoom, so picking never zooms the person out.
 */
export function regionForPick(
  point: { lat: number; lng: number },
  current: MapRegion | null,
): MapRegion {
  const keepZoom =
    current !== null &&
    current.latitudeDelta <= PICK_MAX_DELTA &&
    current.longitudeDelta <= PICK_MAX_DELTA;
  const latitudeDelta = keepZoom ? current.latitudeDelta : NEIGHBOURHOOD_DELTA;
  const longitudeDelta = keepZoom ? current.longitudeDelta : NEIGHBOURHOOD_DELTA;
  return {
    latitude: Math.min(90, Math.max(-90, point.lat - latitudeDelta * SHEET_OFFSET)),
    longitude: point.lng,
    latitudeDelta,
    longitudeDelta,
  };
}
