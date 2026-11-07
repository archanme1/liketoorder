import Supercluster from 'supercluster';

import type { MapRegion } from './region';
import type { Pin } from './schema';

// Pure supercluster wrapper: no React, no native modules. Built once per set of pins; queried per
// settled region (never per frame).

export type PinItem = { kind: 'pin'; key: string; pin: Pin };
export type ClusterItem = {
  kind: 'cluster';
  key: string;
  clusterId: number;
  latitude: number;
  longitude: number;
  count: number;
};
export type MapItem = PinItem | ClusterItem;

type PinProps = { pin: Pin };

const MAX_ZOOM = 20;
const CLUSTER_RADIUS_PX = 56;
// Past this zoom a cluster of pins is shown as individual markers.
const CLUSTER_MAX_ZOOM = 17;
// Fraction of the view added on every side, so markers just off screen are already there.
const VIEW_PADDING = 0.2;
const MIN_ZOOM_TO_CLUSTER_DELTA = 0.004;
const ZOOM_TO_CLUSTER_PADDING = 1.4;

/** The web-mercator zoom level that matches a region's width. Rounded: clusters change by whole levels. */
export function zoomFromRegion(region: MapRegion): number {
  const zoom = Math.round(Math.log2(360 / Math.max(region.longitudeDelta, 1e-6)));
  return Math.min(MAX_ZOOM, Math.max(0, zoom));
}

function bboxFromRegion(region: MapRegion): [number, number, number, number] {
  const halfLat = (region.latitudeDelta / 2) * (1 + VIEW_PADDING);
  const halfLng = (region.longitudeDelta / 2) * (1 + VIEW_PADDING);
  const clampLat = (n: number) => Math.min(90, Math.max(-90, n));
  const clampLng = (n: number) => Math.min(180, Math.max(-180, n));
  return [
    clampLng(region.longitude - halfLng),
    clampLat(region.latitude - halfLat),
    clampLng(region.longitude + halfLng),
    clampLat(region.latitude + halfLat),
  ];
}

export type ClusterIndex = {
  /** What to draw for a region: single pins and clusters. */
  itemsFor(region: MapRegion): MapItem[];
  /** The view that fits every pin inside a cluster, for "tap a cluster to zoom in". */
  regionForCluster(clusterId: number): MapRegion | null;
};

export function createClusterIndex(pins: readonly Pin[]): ClusterIndex {
  const index = new Supercluster<PinProps>({
    radius: CLUSTER_RADIUS_PX,
    maxZoom: CLUSTER_MAX_ZOOM,
  }).load(
    pins.map((pin) => ({
      type: 'Feature' as const,
      properties: { pin },
      geometry: { type: 'Point' as const, coordinates: [pin.lng, pin.lat] },
    })),
  );

  return {
    itemsFor(region) {
      const clusters = index.getClusters(bboxFromRegion(region), zoomFromRegion(region));
      return clusters.map((feature): MapItem => {
        const [longitude, latitude] = feature.geometry.coordinates;
        const props = feature.properties;
        if ('cluster' in props && props.cluster) {
          return {
            kind: 'cluster',
            key: `c${props.cluster_id}`,
            clusterId: props.cluster_id,
            latitude,
            longitude,
            count: props.point_count,
          };
        }
        const { pin } = props as PinProps;
        return { kind: 'pin', key: pin.id, pin };
      });
    },

    regionForCluster(clusterId) {
      let leaves;
      try {
        leaves = index.getLeaves(clusterId, Infinity);
      } catch {
        return null; // an id from an older index
      }
      if (leaves.length === 0) return null;
      let minLat = 90;
      let maxLat = -90;
      let minLng = 180;
      let maxLng = -180;
      for (const leaf of leaves) {
        const [lng, lat] = leaf.geometry.coordinates;
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }
      return {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
        latitudeDelta: Math.max(
          (maxLat - minLat) * ZOOM_TO_CLUSTER_PADDING,
          MIN_ZOOM_TO_CLUSTER_DELTA,
        ),
        longitudeDelta: Math.max(
          (maxLng - minLng) * ZOOM_TO_CLUSTER_PADDING,
          MIN_ZOOM_TO_CLUSTER_DELTA,
        ),
      };
    },
  };
}
