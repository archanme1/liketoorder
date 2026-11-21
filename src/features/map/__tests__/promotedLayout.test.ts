import {
  dailyRankKey,
  LARGE_PROMOTED_LIMIT,
  pickLargePromoted,
  PROMOTED_MIN_SPACING_PX,
  promotionLook,
  screenPoint,
  utcDateOf,
  type LargePromotedInput,
} from '../promotedLayout';
import type { MapRegion } from '../region';
import type { Pin } from '../schema';

const pin = (id: string, lat: number, lng: number, promoted = true): Pin => ({
  id,
  name: id,
  cuisine_code: 'IT',
  lat,
  lng,
  promoted,
});

// Oshawa, 0.1 degree wide on a 400 x 800 point map: 4000 points per degree of longitude, so
// 60 points is 0.015 degree.
const REGION: MapRegion = {
  latitude: 43.9,
  longitude: -78.86,
  latitudeDelta: 0.2,
  longitudeDelta: 0.1,
};
const SCREEN = { width: 400, height: 800 };
const DATE = '2026-11-21';
const NONE: ReadonlySet<string> = new Set();

const pick = (pins: readonly Pin[], over: Partial<LargePromotedInput> = {}) =>
  pickLargePromoted({
    pins,
    region: REGION,
    screen: SCREEN,
    previous: NONE,
    utcDate: DATE,
    ...over,
  });

/** n promoted pins on a grid 0.02 degree (80 points) apart, all inside REGION. */
const grid = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    pin(`g${String(i).padStart(2, '0')}`, 43.82 + Math.floor(i / 5) * 0.03, -78.9 + (i % 5) * 0.02),
  );

const sorted = (ids: Iterable<string>) => [...ids].sort();

describe('screenPoint', () => {
  it('puts the centre of the view in the middle of the map', () => {
    const point = screenPoint(REGION.latitude, REGION.longitude, REGION, SCREEN);
    expect(point?.x).toBeCloseTo(200, 6);
    // Mercator: the middle latitude is a hair below the middle of the screen, never far off.
    expect(Math.abs((point?.y ?? 0) - 400)).toBeLessThan(2);
  });

  it('puts the north-west corner at the top left and the south-east one at the bottom right', () => {
    const nw = screenPoint(44.0, -78.91, REGION, SCREEN);
    const se = screenPoint(43.8, -78.81, REGION, SCREEN);
    expect(nw?.x).toBeCloseTo(0, 6);
    expect(nw?.y).toBeCloseTo(0, 6);
    expect(se?.x).toBeCloseTo(400, 6);
    expect(se?.y).toBeCloseTo(800, 6);
  });

  it('treats all four edges alike: a hair outside is on the edge, clearly outside is out', () => {
    const north = REGION.latitude + REGION.latitudeDelta / 2;
    const south = REGION.latitude - REGION.latitudeDelta / 2;
    const west = REGION.longitude - REGION.longitudeDelta / 2;
    const east = REGION.longitude + REGION.longitudeDelta / 2;
    const hair = 1e-10;
    expect(screenPoint(north + hair, REGION.longitude, REGION, SCREEN)).not.toBeNull();
    expect(screenPoint(south - hair, REGION.longitude, REGION, SCREEN)).not.toBeNull();
    expect(screenPoint(REGION.latitude, east + hair, REGION, SCREEN)).not.toBeNull();
    // West: without the tolerance this wraps round to nearly 360 degrees east and is dropped.
    expect(screenPoint(REGION.latitude, west - hair, REGION, SCREEN)?.x).toBeCloseTo(0, 6);
    const clearly = 1e-6;
    expect(screenPoint(north + clearly, REGION.longitude, REGION, SCREEN)).toBeNull();
    expect(screenPoint(south - clearly, REGION.longitude, REGION, SCREEN)).toBeNull();
    expect(screenPoint(REGION.latitude, east + clearly, REGION, SCREEN)).toBeNull();
    expect(screenPoint(REGION.latitude, west - clearly, REGION, SCREEN)).toBeNull();
  });

  it('is null outside the visible region', () => {
    expect(screenPoint(44.01, -78.86, REGION, SCREEN)).toBeNull();
    expect(screenPoint(43.9, -78.7, REGION, SCREEN)).toBeNull();
  });

  it('works for a view across the 180th meridian', () => {
    const across: MapRegion = {
      latitude: 0,
      longitude: 179.95,
      latitudeDelta: 0.4,
      longitudeDelta: 0.4,
    };
    // The west edge is 179.75; -179.95 is 0.3 degree east of it, three quarters across.
    expect(screenPoint(0, -179.95, across, SCREEN)?.x).toBeCloseTo(300, 6);
    expect(screenPoint(0, 179.0, across, SCREEN)).toBeNull();
  });
});

describe('dailyRankKey and utcDateOf', () => {
  it('is the same all day for one place', () => {
    expect(dailyRankKey('abc', DATE)).toBe(dailyRankKey('abc', DATE));
    expect(Number.isInteger(dailyRankKey('abc', DATE))).toBe(true);
    expect(dailyRankKey('abc', DATE)).toBeGreaterThanOrEqual(0);
  });

  it('orders the places differently on another day', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `place-${i}`);
    const order = (date: string) =>
      [...ids].sort((a, b) => dailyRankKey(a, date) - dailyRankKey(b, date)).join(',');
    expect(order('2026-11-21')).not.toBe(order('2026-11-22'));
  });

  it('keys the rank on the UTC date, not the phone date', () => {
    expect(utcDateOf(new Date('2026-11-21T23:59:59-05:00'))).toBe('2026-11-22');
    expect(utcDateOf(new Date('2026-11-21T00:00:00Z'))).toBe('2026-11-21');
  });
});

describe('pickLargePromoted', () => {
  it('never chooses more than 8, even with 30 well-spaced promoted places in view', () => {
    expect(LARGE_PROMOTED_LIMIT).toBe(8);
    expect(pick(grid(30)).size).toBe(8);
    expect(pick(grid(5)).size).toBe(5);
  });

  it('never puts two large markers closer than 60 points', () => {
    expect(PROMOTED_MIN_SPACING_PX).toBe(60);
    // 40 places packed 0.004 degree (16 points) apart: only well-separated ones can be large.
    const packed = Array.from({ length: 40 }, (_, i) =>
      pin(`k${i}`, 43.85 + Math.floor(i / 8) * 0.004, -78.88 + (i % 8) * 0.004),
    );
    const chosen = packed.filter((p) => pick(packed).has(p.id));
    expect(chosen.length).toBeGreaterThan(0);
    for (const a of chosen) {
      for (const b of chosen) {
        if (a === b) continue;
        const pa = screenPoint(a.lat, a.lng, REGION, SCREEN);
        const pb = screenPoint(b.lat, b.lng, REGION, SCREEN);
        if (!pa || !pb) throw new Error('chosen pin outside the view');
        expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('measures the spacing on screen: two places are both large zoomed in, one zoomed out', () => {
    const pair = [pin('a', 43.9, -78.865), pin('b', 43.9, -78.855)]; // 0.01 degree apart
    expect(pick(pair).size).toBe(1); // 40 points apart at 0.1 degree wide
    const zoomedIn = { ...REGION, latitudeDelta: 0.04, longitudeDelta: 0.02 };
    expect(pick(pair, { region: zoomedIn }).size).toBe(2); // 200 points apart
  });

  it('never chooses a place outside the view', () => {
    expect(pick([pin('far', 43.9, -78.7)]).size).toBe(0);
    expect(pick([pin('far', 43.9, -78.7), pin('near', 43.9, -78.86)])).toEqual(new Set(['near']));
  });

  it('ignores places that are not promoted', () => {
    expect(pick(grid(10).map((p) => ({ ...p, promoted: false }))).size).toBe(0);
    expect(promotionLook(pin('x', 43.9, -78.86, false), new Set(['x']))).toBe('none');
  });

  it('chooses nothing until the map size is known, and nothing from no places', () => {
    expect(pick(grid(10), { screen: { width: 0, height: 0 } }).size).toBe(0);
    expect(pick([]).size).toBe(0);
  });

  it('does not depend on the order the server sent the places in', () => {
    const places = grid(30);
    expect(sorted(pick([...places].reverse()))).toEqual(sorted(pick(places)));
  });

  it('chooses by the daily rank: the same set all day, and the best-ranked first', () => {
    const places = grid(30);
    expect(sorted(pick(places))).toEqual(sorted(pick(places)));
    const best = [...places]
      .sort((a, b) => dailyRankKey(a.id, DATE) - dailyRankKey(b.id, DATE))
      .slice(0, 8)
      .map((p) => p.id);
    expect(sorted(pick(places))).toEqual(sorted(best)); // the grid is spaced, so rank alone decides
  });

  it('keeps the large set of the last view on a small pan, even when a better-ranked place appears', () => {
    const base = [pin('p1', 43.85, -78.88), pin('p2', 43.9, -78.86), pin('p3', 43.95, -78.84)];
    const first = pick(base, { limit: 2 });
    const worst = Math.max(...[...first].map((id) => dailyRankKey(id, DATE)));
    let id = '';
    for (let i = 0; !id; i++) if (dailyRankKey(`new-${i}`, DATE) < worst) id = `new-${i}`;
    const withNew = [...base, pin(id, 43.82, -78.82)];
    const panned = { ...REGION, longitude: -78.858 };

    expect(pick(withNew, { region: panned, limit: 2 }).has(id)).toBe(true); // without memory
    expect(pick(withNew, { region: panned, limit: 2, previous: first })).toEqual(first);
  });

  it('drops a kept place once it is no longer promoted or in view', () => {
    const places = [pin('a', 43.85, -78.88), pin('b', 43.95, -78.84)];
    const previous = new Set(['a', 'gone']);
    const result = pick([{ ...places[0], promoted: false }, places[1]], { previous });
    expect(result).toEqual(new Set(['b']));
  });

  // No wall-clock timing (it flaked under a full parallel jest run: 573 ms against 500 ms). The
  // scale is proven by what the result is, not how fast it came.
  it('handles 500 places: the same cap of 8 as 50 places, and the same answer on every call', () => {
    const grid = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        pin(`m${i}`, 43.81 + (i % 25) * 0.007, -78.905 + Math.floor(i / 25) * 0.0045),
      );
    const many = grid(500);
    const few = grid(50);
    const fromMany = pick(many);
    expect(fromMany.size).toBe(8);
    expect(pick(few).size).toBe(8);
    // Only real ids, and the same set each time for the same input.
    const ids = new Set(many.map((p) => p.id));
    for (const id of fromMany) expect(ids.has(id)).toBe(true);
    for (let run = 0; run < 3; run++) expect(pick(many)).toEqual(fromMany);
  });
});

describe('promotionLook', () => {
  it('is large for a chosen promoted place, ring for the other promoted ones, none otherwise', () => {
    const large = new Set(['big']);
    expect(promotionLook(pin('big', 43.9, -78.86), large)).toBe('large');
    expect(promotionLook(pin('small', 43.9, -78.86), large)).toBe('ring');
    expect(promotionLook(pin('plain', 43.9, -78.86, false), large)).toBe('none');
  });
});
