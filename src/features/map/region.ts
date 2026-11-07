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

/**
 * True when the box the app would send is wider than the server accepts: show "Zoom in", send no
 * request. It checks the snapped box (what is really sent), which can be a little wider than the
 * view itself.
 */
export function isOverServerLimit(region: MapRegion): boolean {
  const box = snapBox(regionToBox(region));
  return box.maxLat - box.minLat > MAX_SPAN_DEGREES || box.maxLng - box.minLng > MAX_SPAN_DEGREES;
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

/** Boxes sent to the server sit on a grid of 1/20 degree (about 5 km). */
export const GRID_STEPS_PER_DEGREE = 20;

/**
 * The box that is actually sent: each edge moves outward to the next grid line, so the sent box
 * always contains the visible one, and every view inside the same grid cells sends exactly the
 * same numbers. That keeps the person's exact position out of the request (centring the map on
 * them would otherwise make the box's middle their position), and gives one cache entry per
 * cell. Longitudes are not wrapped here: the server wraps them, so the date line works.
 */
export function snapBox(box: MapBox): MapBox {
  const down = (n: number) => Math.floor(n * GRID_STEPS_PER_DEGREE) / GRID_STEPS_PER_DEGREE;
  const up = (n: number) => Math.ceil(n * GRID_STEPS_PER_DEGREE) / GRID_STEPS_PER_DEGREE;
  return {
    minLat: Math.max(-90, down(box.minLat)),
    maxLat: Math.min(90, up(box.maxLat)),
    minLng: down(box.minLng),
    maxLng: up(box.maxLng),
  };
}

/** A pick from the list keeps the person's zoom if they are already this close (degrees). */
export const PICK_MAX_DELTA = 0.05;

/** Homemade circle: 500 m, the largest shift the server applies, so the real home is inside. */
export const CIRCLE_RADIUS_M = 500;
/** The circle is drawn only at or below this zoom (latitude span in degrees); above it, none. */
export const CIRCLE_MAX_DELTA = 0.05;

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
