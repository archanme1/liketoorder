import { createClusterIndex, zoomFromRegion } from '../clustering';
import type { Pin } from '../schema';

function pin(id: string, lat: number, lng: number): Pin {
  return { id, name: `Place ${id}`, cuisine_code: 'IT', lat, lng };
}

// A tight group in downtown Toronto and one far away in Ottawa.
const toronto = [
  pin('t1', 43.6532, -79.3832),
  pin('t2', 43.6535, -79.3835),
  pin('t3', 43.6529, -79.3828),
];
const ottawa = pin('o1', 45.4215, -75.6972);

const wholeCity = { latitude: 43.65, longitude: -79.38, latitudeDelta: 0.5, longitudeDelta: 0.5 };
const street = {
  latitude: 43.6532,
  longitude: -79.3832,
  latitudeDelta: 0.002,
  longitudeDelta: 0.002,
};
const province = { latitude: 44.5, longitude: -77.5, latitudeDelta: 5, longitudeDelta: 5 };

describe('zoomFromRegion', () => {
  it('maps the width of the view to a whole zoom level, kept in range', () => {
    expect(zoomFromRegion({ ...wholeCity, longitudeDelta: 360 })).toBe(0);
    expect(zoomFromRegion({ ...wholeCity, longitudeDelta: 180 })).toBe(1);
    expect(zoomFromRegion({ ...wholeCity, longitudeDelta: 0.02 })).toBe(14);
    expect(zoomFromRegion({ ...wholeCity, longitudeDelta: 1e-9 })).toBe(20);
    expect(zoomFromRegion({ ...wholeCity, longitudeDelta: 1000 })).toBe(0);
  });
});

describe('createClusterIndex', () => {
  it('groups nearby pins into one cluster with a count when zoomed out', () => {
    const items = createClusterIndex([...toronto, ottawa]).itemsFor(province);
    const clusters = items.filter((item) => item.kind === 'cluster');
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ kind: 'cluster', count: 3 });
    // The far pin stays a single flag.
    expect(items.filter((item) => item.kind === 'pin').map((item) => item.key)).toEqual(['o1']);
  });

  it('shows every pin on its own when zoomed in', () => {
    const items = createClusterIndex(toronto).itemsFor(street);
    expect(items.every((item) => item.kind === 'pin')).toBe(true);
    expect(items.map((item) => item.key).sort()).toEqual(['t1', 't2', 't3']);
  });

  it('returns only what is inside the view', () => {
    const items = createClusterIndex([...toronto, ottawa]).itemsFor(street);
    expect(items.map((item) => item.key)).not.toContain('o1');
  });

  it('works with no pins', () => {
    const index = createClusterIndex([]);
    expect(index.itemsFor(province)).toEqual([]);
    expect(index.regionForCluster(1)).toBeNull();
  });

  it('gives each item a stable, unique key', () => {
    const items = createClusterIndex([...toronto, ottawa]).itemsFor(province);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });

  it('zooms a cluster to the bounds of its pins, with a little room', () => {
    const index = createClusterIndex(toronto);
    const cluster = index.itemsFor(province).find((item) => item.kind === 'cluster');
    if (cluster?.kind !== 'cluster') throw new Error('expected a cluster');
    const target = index.regionForCluster(cluster.clusterId);
    if (!target) throw new Error('expected a region');
    // Centre = middle of the group; every pin fits inside the view.
    expect(target.latitude).toBeCloseTo((43.6529 + 43.6535) / 2, 6);
    expect(target.longitude).toBeCloseTo((-79.3835 + -79.3828) / 2, 6);
    for (const p of toronto) {
      expect(Math.abs(p.lat - target.latitude)).toBeLessThanOrEqual(target.latitudeDelta / 2);
      expect(Math.abs(p.lng - target.longitude)).toBeLessThanOrEqual(target.longitudeDelta / 2);
    }
    // And it is a real zoom in, not the same view.
    expect(target.latitudeDelta).toBeLessThan(province.latitudeDelta);
  });

  it('never zooms to a zero-size view when pins share one spot', () => {
    const index = createClusterIndex([pin('a', 10, 10), pin('b', 10, 10)]);
    const cluster = index
      .itemsFor({ latitude: 10, longitude: 10, latitudeDelta: 20, longitudeDelta: 20 })
      .find((item) => item.kind === 'cluster');
    if (cluster?.kind !== 'cluster') throw new Error('expected a cluster');
    const target = index.regionForCluster(cluster.clusterId);
    expect(target?.latitudeDelta).toBeGreaterThan(0);
    expect(target?.longitudeDelta).toBeGreaterThan(0);
  });

  it('returns null for a cluster id it does not know', () => {
    expect(createClusterIndex(toronto).regionForCluster(999999)).toBeNull();
  });

  it('handles 500 pins well inside a frame budget', () => {
    const pins = Array.from({ length: 500 }, (_, i) =>
      pin(`p${i}`, 43 + (i % 25) * 0.04, -80 + Math.floor(i / 25) * 0.04),
    );
    const start = performance.now();
    const index = createClusterIndex(pins);
    for (let i = 0; i < 20; i++) index.itemsFor(province);
    const elapsed = performance.now() - start;
    expect(index.itemsFor(province).length).toBeGreaterThan(0);
    // Generous bound so a slow CI machine doesn't flake: build once + 20 queries.
    expect(elapsed).toBeLessThan(500);
  });
});
