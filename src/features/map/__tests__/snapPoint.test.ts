import { GRID_STEPS_PER_DEGREE, snapPoint } from '../region';

// Spec 16 Decision D2: only snapPoint output reaches the server. Values are built from integers
// (n / 20 grid points, (2k + 1) / 40 half steps) so the cases sit exactly where they are meant to.

const STEP = 1 / GRID_STEPS_PER_DEGREE;
// list_offers_near's own grid test.
const onServerGrid = (v: number) => Math.abs(v * 20 - Math.round(v * 20)) <= 1e-9;

function snap(lat: number, lng: number) {
  const point = snapPoint(lat, lng);
  if (!point) throw new Error(`snapPoint(${lat}, ${lng}) gave null`);
  return point;
}

describe('snapPoint', () => {
  it('moves an off-grid position to the nearest grid point', () => {
    // Oshawa's centre (the launch area): 43.8971, -78.8658.
    expect(snap(438971 / 10000, -788658 / 10000)).toEqual({ lat: 43.9, lng: -78.85 });
    expect(snap(4386 / 100, -7887 / 100)).toEqual({ lat: 43.85, lng: -78.85 });
  });

  it('keeps a point already on the grid', () => {
    for (const [lat, lng] of [
      [877 / 20, -1577 / 20],
      [0, 0],
      [-30, 151],
      [90, 179],
      [-90, -180],
    ]) {
      expect(snap(lat, lng)).toEqual({ lat, lng });
    }
  });

  it('sends longitude 180 as -180 (the same meridian; the server accepts both)', () => {
    expect(snap(0, 180)).toEqual({ lat: 0, lng: -180 });
  });

  it('rounds a half step up (towards +infinity), the Math.round rule', () => {
    // 43.875 = 1755 / 40 sits between 43.85 and 43.9.
    expect(snap(1755 / 40, 0).lat).toBe(43.9);
    // -78.875 = -3155 / 40 sits between -78.9 and -78.85.
    expect(snap(0, -3155 / 40).lng).toBe(-78.85);
    // -0.025 rounds up to 0, and comes back as +0.
    expect(Object.is(snap(-1 / 40, 0).lat, 0)).toBe(true);
  });

  it('never answers -0', () => {
    const point = snap(-1 / 100, -1 / 100);
    expect(Object.is(point.lat, 0)).toBe(true);
    expect(Object.is(point.lng, 0)).toBe(true);
  });

  it('wraps longitudes past the date line before rounding', () => {
    expect(snap(0, 17999 / 100).lng).toBe(180);
    expect(snap(0, 18001 / 100).lng).toBe(-180);
    expect(snap(0, 540).lng).toBe(-180);
    expect(snap(0, -18001 / 100).lng).toBe(180);
    expect(snap(0, 360 + 1 / 10).lng).toBe(0.1);
  });

  it('keeps latitudes at the poles inside [-90, 90]', () => {
    expect(snap(8999 / 100, 0).lat).toBe(90);
    expect(snap(-8999 / 100, 0).lat).toBe(-90);
    expect(snap(90, 0).lat).toBe(90);
    expect(snap(-90, 0).lat).toBe(-90);
  });

  it('gives null for what can never be a position', () => {
    expect(snapPoint(Number.NaN, 0)).toBeNull();
    expect(snapPoint(0, Number.NaN)).toBeNull();
    expect(snapPoint(Number.POSITIVE_INFINITY, 0)).toBeNull();
    expect(snapPoint(0, Number.NEGATIVE_INFINITY)).toBeNull();
    expect(snapPoint(9001 / 100, 0)).toBeNull();
    expect(snapPoint(-9001 / 100, 0)).toBeNull();
  });

  it('never returns an off-grid input, moves it at most half a step, and always passes the server check', () => {
    // A fixed pseudo-random walk (no Math.random), so a failure is reproducible.
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 2000; i += 1) {
      const lat = next() * 178 - 89;
      const lng = next() * 358 - 179;
      const point = snap(lat, lng);
      if (onServerGrid(lat) && onServerGrid(lng)) continue;
      expect(point.lat === lat && point.lng === lng).toBe(false);
      expect(Math.abs(point.lat - lat)).toBeLessThanOrEqual(STEP / 2 + 1e-12);
      expect(Math.abs(point.lng - lng)).toBeLessThanOrEqual(STEP / 2 + 1e-12);
      expect(onServerGrid(point.lat)).toBe(true);
      expect(onServerGrid(point.lng)).toBe(true);
    }
  });

  it('gives the same point for every position inside one cell', () => {
    const centre = snap(877 / 20, -1577 / 20);
    for (const dLat of [-249, -100, 0, 100, 249]) {
      for (const dLng of [-249, 0, 249]) {
        expect(snap(877 / 20 + dLat / 10000, -1577 / 20 + dLng / 10000)).toEqual(centre);
      }
    }
  });

  it('answers only the two numbers', () => {
    expect(Object.keys(snap(438971 / 10000, -788658 / 10000)).sort()).toEqual(['lat', 'lng']);
  });
});
