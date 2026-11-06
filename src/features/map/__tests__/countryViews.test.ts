import { COUNTRY_VIEWS, getCountryView, MAX_DELTA } from '../countryViews';
import { MAX_SPAN_DEGREES } from '../region';

/* eslint-disable @typescript-eslint/no-require-imports */
// The project has no Node type definitions, so these two are loaded untyped on purpose.
const { readFileSync } = require('fs') as {
  readFileSync(path: string, encoding: 'utf8'): string;
};
const { join } = require('path') as { join(...parts: string[]): string };
/* eslint-enable @typescript-eslint/no-require-imports */

// Every country code in the cuisine catalog seed (the 'XX' codes in its insert).
function catalogCountryCodes(): string[] {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20261103040302_cuisine_catalog.sql'),
    'utf8',
  );
  return [...new Set([...sql.matchAll(/\('([A-Z]{2})'/g)].map((m) => m[1]))];
}

describe('countryViews', () => {
  it('has a valid centre and a positive span of at most 40° for every entry', () => {
    for (const [code, [lat, lng, latDelta, lngDelta]] of Object.entries(COUNTRY_VIEWS)) {
      expect({ code, ok: lat >= -90 && lat <= 90 }).toEqual({ code, ok: true });
      expect({ code, ok: lng >= -180 && lng <= 180 }).toEqual({ code, ok: true });
      expect({ code, ok: latDelta > 0 && latDelta <= MAX_DELTA }).toEqual({ code, ok: true });
      expect({ code, ok: lngDelta > 0 && lngDelta <= MAX_DELTA }).toEqual({ code, ok: true });
    }
  });

  it('keeps every span well under the server limit', () => {
    expect(MAX_DELTA).toBeLessThan(MAX_SPAN_DEGREES);
  });

  it('has an entry for every country in the cuisine catalog', () => {
    const codes = catalogCountryCodes();
    expect(codes.length).toBeGreaterThan(150);
    const missing = codes.filter((code) => getCountryView(code) === null);
    expect(missing).toEqual([]);
  });

  it('returns the view for a known region code, in any letter case', () => {
    expect(getCountryView('FR')).toEqual({
      latitude: 46.6,
      longitude: 2.5,
      latitudeDelta: 10,
      longitudeDelta: 13,
    });
    expect(getCountryView('fr')).toEqual(getCountryView('FR'));
  });

  it.each([null, undefined, '', '001', 'ZZ', 'constructor', '__proto__'])(
    'returns nothing for %p',
    (code) => {
      expect(getCountryView(code)).toBeNull();
    },
  );
});
