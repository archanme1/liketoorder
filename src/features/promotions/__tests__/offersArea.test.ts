import type { MapRegion } from '@/features/map/region';

import { LAUNCH_AREA } from '../launchArea';
import {
  areaHeading,
  areaName,
  areaNotice,
  fallbackArea,
  MAX_FALLBACK_SPAN_DEGREES,
} from '../offersArea';

const city = (latitude: number, longitude: number, delta = 1 / 10): MapRegion => ({
  latitude,
  longitude,
  latitudeDelta: delta,
  longitudeDelta: delta,
});
const toronto = city(43.65, -79.38);
const cambridge = city(43.36, -80.31);
const launch = {
  source: 'launch',
  latitude: LAUNCH_AREA.latitude,
  longitude: LAUNCH_AREA.longitude,
};

describe('fallbackArea', () => {
  it('uses the last Restaurants view first', () => {
    expect(fallbackArea(toronto, cambridge)).toEqual({
      source: 'last_map',
      latitude: 43.65,
      longitude: -79.38,
    });
  });

  it('then the last Homemade view', () => {
    expect(fallbackArea(null, cambridge)).toEqual({
      source: 'last_map',
      latitude: 43.36,
      longitude: -80.31,
    });
  });

  it('then the launch area', () => {
    expect(fallbackArea(null, null)).toEqual(launch);
  });

  it('skips a saved view wider than 1 degree (a country or world view)', () => {
    const country = city(47, -85, 24);
    expect(fallbackArea(country, cambridge).latitude).toBe(43.36);
    expect(fallbackArea(country, country)).toEqual(launch);
    expect(fallbackArea(city(43, -79, MAX_FALLBACK_SPAN_DEGREES), null).source).toBe('last_map');
    expect(
      fallbackArea({ ...toronto, longitudeDelta: MAX_FALLBACK_SPAN_DEGREES + 1 / 100 }, null),
    ).toEqual(launch);
  });

  it('skips a saved view that is not a real region', () => {
    expect(fallbackArea({ ...toronto, latitude: Number.NaN }, null)).toEqual(launch);
  });
});

describe('area wording', () => {
  it('names the area', () => {
    expect(areaName('launch')).toBe('Oshawa');
    expect(areaName('last_map')).toBe('the area you last viewed on the map');
  });

  it('heads the list', () => {
    expect(areaHeading('me')).toBe('Near you');
    expect(areaHeading('launch')).toBe('Near Oshawa');
    expect(areaHeading('last_map')).toBe('Near the area you last viewed on the map');
  });

  it('says "Location is off" only when it is off', () => {
    expect(areaNotice('location_off', 'launch')).toBe(
      'Location is off. Showing offers near Oshawa.',
    );
    expect(areaNotice('location_off', 'last_map')).toBe(
      'Location is off. Showing offers near the area you last viewed on the map.',
    );
  });

  it('never says "off" when the person was not asked or said Not now', () => {
    expect(areaNotice('not_asked', 'launch')).toBe('Showing offers near Oshawa.');
    expect(areaNotice('not_asked', 'last_map')).toBe(
      'Showing offers near the area you last viewed on the map.',
    );
    expect(areaNotice('not_asked', 'launch')).not.toMatch(/Location is off/);
    expect(areaNotice('no_fix', 'launch')).not.toMatch(/Location is off/);
  });

  it('says when no position came in time', () => {
    expect(areaNotice('no_fix', 'launch')).toBe(
      "We couldn't find your location. Showing offers near Oshawa.",
    );
  });
});
