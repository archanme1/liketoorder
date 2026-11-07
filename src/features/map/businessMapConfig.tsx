import type { ReactNode } from 'react';

import type { Cuisine } from '@/features/cuisines/schema';

import type { MapErrorCode } from './api';
import { FlagMarker } from './components/FlagMarker';
import { PLACES_TITLE, NO_PLACES_MESSAGE } from './components/PlacesList';
import type { SheetBodyProps } from './components/RestaurantSheet';
import { SheetDetails } from './components/SheetDetails';
import { ZOOM_IN_MESSAGE } from './components/MapNotices';
import { REGION_KEY } from './lastRegion';
import { usePinsInBounds } from './hooks/usePinsInBounds';
import type { MapBox } from './region';
import type { Pin } from './schema';

export type MarkerProps = {
  pin: Pin;
  cuisine: Cuisine | undefined;
  selected: boolean;
  onSelect: (pin: Pin) => void;
  /** True while zoomed in enough for the Homemade circle. The Restaurants marker ignores it. */
  zoomedIn: boolean;
};

/** What a pins hook hands the screen (the shape usePinsQuery returns). */
export type PinsResult = {
  pins: Pin[];
  capped: boolean;
  tooLarge: boolean;
  hasData: boolean;
  isFetching: boolean;
  error: { code: MapErrorCode } | null;
  retry: () => void;
};

/**
 * Everything that differs between the Restaurants and Homemade tabs. The map screen, sheet and
 * list are shared; a tab is this object. Define it once at module level: the screen reads the
 * same `usePins` hook on every render.
 */
export type BusinessMapConfig = {
  kind: 'restaurant' | 'homemade';
  /** Accessibility label of the map itself. */
  mapLabel: string;
  /** Where this tab keeps its last viewed region on the phone. */
  regionKey: string;
  /** What the location note says the map shows ("restaurants"). */
  promptThings: string;
  texts: {
    /** Plural noun: "Loading <things>", "We couldn't load <things>". */
    things: string;
    zoomIn: string;
    emptyTitle: string;
    listHint: string;
    listEmpty: string;
    placesTitle: string;
    detailsLabel: string;
  };
  usePins: (box: MapBox | null) => PinsResult;
  renderMarker: (props: MarkerProps) => ReactNode;
  DetailsBody: (props: SheetBodyProps) => ReactNode;
};

export const restaurantMapConfig: BusinessMapConfig = {
  kind: 'restaurant',
  mapLabel: 'Restaurants map',
  regionKey: REGION_KEY,
  promptThings: 'restaurants and homemade cooks',
  texts: {
    things: 'restaurants',
    zoomIn: ZOOM_IN_MESSAGE,
    emptyTitle: 'No restaurants here yet',
    listHint: 'Opens a list of the restaurants on the map',
    listEmpty: NO_PLACES_MESSAGE,
    placesTitle: PLACES_TITLE,
    detailsLabel: 'Restaurant details',
  },
  usePins: usePinsInBounds,
  renderMarker: ({ pin, cuisine, selected, onSelect }) => (
    <FlagMarker pin={pin} cuisine={cuisine} selected={selected} onSelect={onSelect} />
  ),
  DetailsBody: SheetDetails,
};
