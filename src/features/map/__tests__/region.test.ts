import {
  isOverServerLimit,
  isValidRegion,
  MAX_SPAN_DEGREES,
  PICK_MAX_DELTA,
  regionAround,
  regionForPick,
  regionToBox,
  WORLD_REGION,
} from '../region';

const base = { latitude: 10, longitude: 20, latitudeDelta: 1, longitudeDelta: 2 };

describe('region', () => {
  it('turns a region into the box the server receives', () => {
    expect(regionToBox(base)).toEqual({ minLat: 9.5, maxLat: 10.5, minLng: 19, maxLng: 21 });
  });

  it('centres on a position at neighbourhood zoom', () => {
    expect(regionAround(1, 2)).toEqual({
      latitude: 1,
      longitude: 2,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
  });

  it('knows the world view is over the server limit and a city is not', () => {
    expect(isOverServerLimit(WORLD_REGION)).toBe(true);
    expect(isOverServerLimit(base)).toBe(false);
    expect(isOverServerLimit({ ...base, latitudeDelta: MAX_SPAN_DEGREES })).toBe(false);
    expect(isOverServerLimit({ ...base, longitudeDelta: MAX_SPAN_DEGREES + 0.1 })).toBe(true);
  });

  it('validates regions', () => {
    expect(isValidRegion(base)).toBe(true);
    expect(isValidRegion({ ...base, latitude: 91 })).toBe(false);
    expect(isValidRegion({ ...base, longitude: -181 })).toBe(false);
    expect(isValidRegion({ ...base, latitudeDelta: 0 })).toBe(false);
    expect(isValidRegion({ ...base, longitudeDelta: Number.NaN })).toBe(false);
    expect(isValidRegion({ ...base, latitude: '1' })).toBe(false);
    expect(isValidRegion(null)).toBe(false);
    expect(isValidRegion('x')).toBe(false);
  });
});

describe('regionForPick', () => {
  const pin = { lat: 43.9, lng: -78.86 };

  it('centres a pin picked from a wide view at neighbourhood zoom, above the half-open sheet', () => {
    const target = regionForPick(pin, { ...base, latitudeDelta: 5, longitudeDelta: 5 });
    expect(target.longitude).toBe(-78.86);
    expect(target.latitudeDelta).toBe(0.02);
    expect(target.longitudeDelta).toBe(0.02);
    // The view centre sits a quarter of its height south, so the pin is mid-way up the part of
    // the map the sheet leaves free.
    expect(target.latitude).toBeCloseTo(43.9 - 0.02 * 0.25, 10);
    expect(isValidRegion(target)).toBe(true);
  });

  it('uses neighbourhood zoom when there is no current view', () => {
    expect(regionForPick(pin, null)).toMatchObject({ latitudeDelta: 0.02, longitudeDelta: 0.02 });
  });

  it('keeps the zoom when the view is already this close, so picking never zooms out', () => {
    const close = { ...base, latitudeDelta: 0.01, longitudeDelta: 0.012 };
    const target = regionForPick(pin, close);
    expect(target.latitudeDelta).toBe(0.01);
    expect(target.longitudeDelta).toBe(0.012);
    expect(target.latitude).toBeCloseTo(43.9 - 0.01 * 0.25, 10);
  });

  it('keeps the zoom up to exactly the limit, and not beyond it', () => {
    const edge = { ...base, latitudeDelta: PICK_MAX_DELTA, longitudeDelta: PICK_MAX_DELTA };
    expect(regionForPick(pin, edge).latitudeDelta).toBe(PICK_MAX_DELTA);
    const past = { ...edge, longitudeDelta: PICK_MAX_DELTA + 0.001 };
    expect(regionForPick(pin, past).latitudeDelta).toBe(0.02);
  });

  it('stays a valid region at the poles', () => {
    const target = regionForPick({ lat: -90, lng: 0 }, null);
    expect(target.latitude).toBeGreaterThanOrEqual(-90);
    expect(isValidRegion(target)).toBe(true);
  });
});
