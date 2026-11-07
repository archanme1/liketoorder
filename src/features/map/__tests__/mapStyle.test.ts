import { MAP_STYLE } from '../mapStyle';

describe('MAP_STYLE', () => {
  it('has one rule: Google business POIs off', () => {
    expect(MAP_STYLE).toEqual([{ featureType: 'poi.business', stylers: [{ visibility: 'off' }] }]);
  });

  it('leaves roads, place names, parks and transit alone', () => {
    const text = JSON.stringify(MAP_STYLE);
    expect(text).not.toMatch(/road|administrative|landscape|transit|water|labels|poi\.park|"poi"/);
  });

  it('is valid JSON for the native style parser', () => {
    expect(() => JSON.parse(JSON.stringify(MAP_STYLE))).not.toThrow();
  });
});
