import { buildDirectionsUrl, directionsLabel } from '../directions';

describe('buildDirectionsUrl', () => {
  it('builds the documented Google Maps search URL with the place id', () => {
    expect(buildDirectionsUrl('Lakeview Trattoria', 'ChIJabc123')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Lakeview%20Trattoria&query_place_id=ChIJabc123',
    );
  });

  it('encodes names with spaces, symbols, accents and other scripts', () => {
    const url = buildDirectionsUrl("Joe's Fish & Chips (Oshawa) #1 + more? café 東京", 'ChIJ x/y');
    expect(url).toBe(
      'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent("Joe's Fish & Chips (Oshawa) #1 + more? café 東京") +
        '&query_place_id=ChIJ%20x%2Fy',
    );
    // No raw ampersand, hash or space can end the query early or start a new parameter.
    const query = url.split('&query=')[1].split('&query_place_id=')[0];
    expect(query).not.toMatch(/[& #?+]/);
  });

  it('is a Google Maps link only: https, google.com, no coordinates, no Apple Maps', () => {
    const url = buildDirectionsUrl('Cafe', 'FAKE_PLACE_oshawa_001');
    expect(url.startsWith('https://www.google.com/maps/search/?api=1&query=')).toBe(true);
    expect(url).toContain('query_place_id=FAKE_PLACE_oshawa_001');
    expect(url).not.toMatch(
      /maps\.apple\.com|maps:|geo:|[?&](ll|q|saddr|daddr|center|destination)=/i,
    );
    // Nothing that looks like a latitude/longitude pair.
    expect(url).not.toMatch(/-?\d{1,3}\.\d{3,},\s*-?\d{1,3}\.\d{3,}/);
  });

  it('names the action for screen readers', () => {
    expect(directionsLabel("Joe's")).toBe("Directions to Joe's in Google Maps");
  });
});
