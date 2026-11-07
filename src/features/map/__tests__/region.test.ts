import {
  isOverServerLimit,
  isValidRegion,
  MAX_SPAN_DEGREES,
  PICK_MAX_DELTA,
  regionAround,
  regionForPick,
  regionToBox,
  snapBox,
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

describe('snapBox: the box that is sent', () => {
  const view = (latitude: number, longitude: number, delta = 0.02) =>
    regionToBox({ latitude, longitude, latitudeDelta: delta, longitudeDelta: delta });

  it('moves every edge outward onto the 0.05 degree grid', () => {
    expect(snapBox({ minLat: 12.3105, maxLat: 12.3305, minLng: 65.3505, maxLng: 65.3705 })).toEqual(
      {
        minLat: 12.3,
        maxLat: 12.35,
        minLng: 65.35,
        maxLng: 65.4,
      },
    );
  });

  it('sends identical numbers for two positions in the same grid cell', () => {
    const a = snapBox(view(12.3105, 65.3605));
    const b = snapBox(view(12.3205, 65.3705));
    expect(a).toEqual(b);
  });

  it('does not leave the position at the middle of the sent box', () => {
    const person = { lat: 12.3105, lng: 65.3605 };
    const box = snapBox(view(person.lat, person.lng));
    expect(Math.abs((box.minLat + box.maxLat) / 2 - person.lat)).toBeGreaterThan(0.009);
    expect(Math.abs((box.minLng + box.maxLng) / 2 - person.lng)).toBeGreaterThan(0.009);
  });

  it.each([
    ['a neighbourhood', 43.6532, -79.3832, 0.02],
    ['a city', 43.6532, -79.3832, 0.4],
    ['the southern hemisphere', -33.8688, 151.2093, 0.07],
    ['the date line (east)', 10.003, 179.995, 0.04],
    ['the date line (west)', -4.5, -179.992, 0.06],
    ['the pole', 89.99, 10, 0.05],
  ])('always contains the visible area: %s', (_name, lat, lng, delta) => {
    const visible = view(lat, lng, delta);
    const sent = snapBox(visible);
    expect(sent.minLat).toBeLessThanOrEqual(Math.max(-90, visible.minLat));
    expect(sent.maxLat).toBeGreaterThanOrEqual(Math.min(90, visible.maxLat));
    expect(sent.minLng).toBeLessThanOrEqual(visible.minLng);
    expect(sent.maxLng).toBeGreaterThanOrEqual(visible.maxLng);
    expect(sent.minLat).toBeGreaterThanOrEqual(-90);
    expect(sent.maxLat).toBeLessThanOrEqual(90);
  });

  it('keeps the date line: an edge past 180 is not wrapped or clamped here', () => {
    const sent = snapBox(view(10.003, 179.995, 0.04));
    expect(sent.maxLng).toBeGreaterThan(180);
    expect(sent.minLng).toBeLessThan(180);
  });

  it('counts the wider snapped box when deciding a view is too wide for the server', () => {
    // 89.99 degrees wide on its own, but snapped outward it is over 90.
    const almost = {
      latitude: 10.012,
      longitude: 20.012,
      latitudeDelta: 89.99,
      longitudeDelta: 10,
    };
    expect(isOverServerLimit(almost)).toBe(true);
    const box = snapBox(regionToBox(almost));
    expect(box.maxLat - box.minLat).toBeGreaterThan(MAX_SPAN_DEGREES);
  });
});
