import { fetchHomemadeInBounds } from '../api';
import type { MapBox } from '../region';

import { usePinsQuery } from './usePinsQuery';

export const homemadePinsKey = (box: MapBox) => ['map', 'homemade', 'pins', box] as const;

const HOMEMADE_PINS = {
  keyPrefix: ['map', 'homemade', 'pins'],
  fetcher: (box: MapBox) => fetchHomemadeInBounds(box),
} as const;

/** Homemade pins for the settled map box. Same behaviour as the restaurant pins (usePinsQuery). */
export function useHomemadeInBounds(box: MapBox | null) {
  return usePinsQuery(HOMEMADE_PINS, box);
}
