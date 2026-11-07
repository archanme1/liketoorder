import { fetchPinsInBounds } from '../api';
import type { MapBox } from '../region';

import { usePinsQuery } from './usePinsQuery';

export const pinsKey = (box: MapBox) => ['map', 'pins', box] as const;

const RESTAURANT_PINS = {
  keyPrefix: ['map', 'pins'],
  fetcher: (box: MapBox) => fetchPinsInBounds(box),
} as const;

/**
 * Restaurant pins for the settled map box. The key holds the snapped box, so only the latest box
 * is rendered and a late answer for an old area is dropped (see usePinsQuery).
 */
export function usePinsInBounds(box: MapBox | null) {
  return usePinsQuery(RESTAURANT_PINS, box);
}
