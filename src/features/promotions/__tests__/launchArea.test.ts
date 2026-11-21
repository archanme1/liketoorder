import { isValidRegion, snapPoint } from '@/features/map/region';

import { LAUNCH_AREA } from '../launchArea';

describe('LAUNCH_AREA', () => {
  it('is the centre of Oshawa, Ontario (a placeholder until the launch city is chosen)', () => {
    expect(LAUNCH_AREA).toEqual({ name: 'Oshawa', latitude: 43.8971, longitude: -78.8658 });
  });

  it('is a real position', () => {
    expect(isValidRegion({ ...LAUNCH_AREA, latitudeDelta: 1, longitudeDelta: 1 })).toBe(true);
  });

  it('snaps to a grid point the server accepts', () => {
    expect(snapPoint(LAUNCH_AREA.latitude, LAUNCH_AREA.longitude)).toEqual({
      lat: 43.9,
      lng: -78.85,
    });
  });
});
