import {
  isOverServerLimit,
  isValidRegion,
  MAX_SPAN_DEGREES,
  regionAround,
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
