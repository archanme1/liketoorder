import { distanceKm, distanceText, EARTH_RADIUS_KM } from '../distance';

// Spec 16 Decision D12: every distance is "about", from the real position or the area's centre.

const KM_PER_DEGREE = (EARTH_RADIUS_KM * Math.PI) / 180;
const origin = { latitude: 0, longitude: 0 };
/** A point `km` north of the origin (along a meridian, so the distance is exact). */
const north = (km: number) => ({ lat: km / KM_PER_DEGREE, lng: 0 });

describe('distanceKm', () => {
  it('is 0 for the same point', () => {
    expect(distanceKm(origin, { lat: 0, lng: 0 })).toBe(0);
  });

  it('measures along a meridian exactly', () => {
    expect(distanceKm(origin, north(10))).toBeCloseTo(10, 9);
  });

  it('measures across the date line the short way', () => {
    const km = distanceKm({ latitude: 0, longitude: 17995 / 100 }, { lat: 0, lng: -17995 / 100 });
    expect(km).toBeCloseTo(KM_PER_DEGREE / 10, 6);
  });

  it('agrees with the server formula between Oshawa and Whitby (about 6 km)', () => {
    const km = distanceKm({ latitude: 43.9, longitude: -78.85 }, { lat: 43.8975, lng: -78.9429 });
    expect(km).toBeGreaterThan(7);
    expect(km).toBeLessThan(8);
  });
});

describe('distanceText', () => {
  it('says "Less than 1 km away" under 1 km', () => {
    expect(distanceText(0, 'restaurant')).toBe('Less than 1 km away');
    expect(distanceText(999 / 1000, 'restaurant')).toBe('Less than 1 km away');
  });

  it('rounds to whole km from 1 km on', () => {
    expect(distanceText(1, 'restaurant')).toBe('About 1 km away');
    expect(distanceText(14 / 10, 'restaurant')).toBe('About 1 km away');
    expect(distanceText(15 / 10, 'restaurant')).toBe('About 2 km away');
    expect(distanceText(296 / 10, 'restaurant')).toBe('About 30 km away');
  });

  it('adds ", approximate area" for a home cook', () => {
    expect(distanceText(1 / 2, 'homemade')).toBe('Less than 1 km away, approximate area');
    expect(distanceText(4, 'homemade')).toBe('About 4 km away, approximate area');
  });

  it('gives nothing for a distance that cannot be worked out', () => {
    expect(distanceText(Number.NaN, 'restaurant')).toBeNull();
    expect(distanceText(Number.POSITIVE_INFINITY, 'homemade')).toBeNull();
    expect(distanceText(-1, 'restaurant')).toBeNull();
  });

  it('works end to end from a point and a place', () => {
    expect(distanceText(distanceKm(origin, north(41 / 10)), 'restaurant')).toBe('About 4 km away');
    expect(distanceText(distanceKm(origin, north(3 / 10)), 'homemade')).toBe(
      'Less than 1 km away, approximate area',
    );
  });
});
