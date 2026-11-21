import type { MapRegion } from './region';
import type { Pin } from './schema';

// Pure: no React, no native modules. Decides which promoted places get the larger, animated marker
// (spec 16 Q4): at most LARGE_PROMOTED_LIMIT at once, never two closer than
// PROMOTED_MIN_SPACING_PX on screen, chosen by a daily rank that is the same for everyone all day.
// Every other promoted place is drawn normal size with the ring and the "Ad" badge. Run on the
// settled region only (never per frame).

export const LARGE_PROMOTED_LIMIT = 8;
export const PROMOTED_MIN_SPACING_PX = 60;

/** How a pin is drawn: organic, normal size with the ad ring, or the larger animated marker. */
export type PromotionLook = 'none' | 'ring' | 'large';

export type ScreenSize = { width: number; height: number };
type Point = { x: number; y: number };

// Web Mercator stops at about 85 degrees; past it the projection runs off to infinity.
const MAX_LAT = 85;
// A point exactly on the view's edge stays inside despite floating-point rounding.
const EDGE_EPSILON = 1e-9;

/** The UTC calendar date (YYYY-MM-DD) the daily rank is keyed on. */
export function utcDateOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The place's rank for one UTC date: 32-bit FNV-1a of "<id>|<date>". Lower ranks first. The same
 * on every phone all day, different the next day, so no place is always first.
 */
export function dailyRankKey(id: string, utcDate: string): number {
  const text = `${id}|${utcDate}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function mercatorY(lat: number): number {
  const clamped = Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
  return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
}

/**
 * Longitude from the view's west edge, 0 to 360, so a view across the 180th meridian works. A
 * point a hair west of the edge (within EDGE_EPSILON) counts as on it, like the other three edges,
 * instead of wrapping round to nearly 360.
 */
function eastOf(west: number, lng: number): number {
  const east = (((lng - west) % 360) + 360) % 360;
  return east > 360 - EDGE_EPSILON ? 0 : east;
}

type Projector = (lat: number, lng: number) => Point | null;

/**
 * The projection of one view onto the screen, worked out once (the view's edges and Mercator span)
 * and then applied to each point. Null for a point outside the visible region.
 */
function projectorFor(region: MapRegion, screen: ScreenSize): Projector {
  const north = region.latitude + region.latitudeDelta / 2;
  const south = region.latitude - region.latitudeDelta / 2;
  const west = region.longitude - region.longitudeDelta / 2;
  const top = mercatorY(north);
  const span = top - mercatorY(south);
  if (span <= 0 || region.longitudeDelta <= 0) return () => null;
  return (lat, lng) => {
    if (lat > north + EDGE_EPSILON || lat < south - EDGE_EPSILON) return null;
    const east = eastOf(west, lng);
    if (east > region.longitudeDelta + EDGE_EPSILON) return null;
    return {
      x: (east / region.longitudeDelta) * screen.width,
      y: ((top - mercatorY(lat)) / span) * screen.height,
    };
  };
}

/**
 * Where a point sits on the map, in screen points from the top left, or null when it is outside
 * the visible region. x is linear in longitude; y follows the map's Mercator projection.
 */
export function screenPoint(
  lat: number,
  lng: number,
  region: MapRegion,
  screen: ScreenSize,
): Point | null {
  return projectorFor(region, screen)(lat, lng);
}

export type LargePromotedInput = {
  pins: readonly Pin[];
  /** The settled visible region. */
  region: MapRegion;
  /** The map's measured size in points. Nothing is chosen until it is known. */
  screen: ScreenSize;
  /** The ids chosen for the last region: kept first, so a pan never reshuffles the large set. */
  previous: ReadonlySet<string>;
  utcDate: string;
  limit?: number;
  minSpacingPx?: number;
};

/** The promoted pins drawn large for this region. */
export function pickLargePromoted({
  pins,
  region,
  screen,
  previous,
  utcDate,
  limit = LARGE_PROMOTED_LIMIT,
  minSpacingPx = PROMOTED_MIN_SPACING_PX,
}: LargePromotedInput): Set<string> {
  const chosen = new Set<string>();
  if (screen.width <= 0 || screen.height <= 0 || limit <= 0) return chosen;

  const project = projectorFor(region, screen);
  const candidates: { id: string; kept: boolean; rank: number; point: Point }[] = [];
  for (const pin of pins) {
    if (!pin.promoted) continue;
    const point = project(pin.lat, pin.lng);
    if (!point) continue;
    candidates.push({
      id: pin.id,
      kept: previous.has(pin.id),
      rank: dailyRankKey(pin.id, utcDate),
      point,
    });
  }
  // Kept first, then by daily rank, then by id: the input order never matters.
  candidates.sort(
    (a, b) =>
      Number(b.kept) - Number(a.kept) ||
      a.rank - b.rank ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const minSquared = minSpacingPx * minSpacingPx;
  const placed: Point[] = [];
  for (const candidate of candidates) {
    if (chosen.size >= limit) break;
    const { x, y } = candidate.point;
    const crowded = placed.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < minSquared);
    if (crowded) continue;
    chosen.add(candidate.id);
    placed.push(candidate.point);
  }
  return chosen;
}

/** How one pin is drawn, given the large set. */
export function promotionLook(pin: Pin, large: ReadonlySet<string>): PromotionLook {
  if (!pin.promoted) return 'none';
  return large.has(pin.id) ? 'large' : 'ring';
}
