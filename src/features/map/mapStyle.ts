import type { MapStyleElement } from 'react-native-maps';

/**
 * Hides Google's own business labels and pins (the orange restaurant and shop markers) so the
 * only restaurant pins on our map are ours. Road names, place names, parks, transit and the
 * rest of the map are untouched. One rule on purpose: add nothing here without a reason.
 */
export const MAP_STYLE: MapStyleElement[] = [
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
];
