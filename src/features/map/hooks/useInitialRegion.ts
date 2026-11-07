import { getLocales } from 'expo-localization';
import { useEffect, useRef, useState } from 'react';

import { getCountryView } from '../countryViews';
import { readLastRegion } from '../lastRegion';
import { regionAround, WORLD_REGION, type MapRegion } from '../region';
import type { LocationState, Position } from './useLocationPermission';

export type OpeningSource = 'last' | 'country' | 'world';

export type OpeningView = { region: MapRegion; source: OpeningSource };

/** The opening view when the person's own position is not available: last view, country, world. */
export function resolveFallbackView(
  lastRegion: MapRegion | null,
  regionCode: string | null | undefined,
): OpeningView {
  if (lastRegion) return { region: lastRegion, source: 'last' };
  const country = getCountryView(regionCode);
  if (country) return { region: country, source: 'country' };
  return { region: WORLD_REGION, source: 'world' };
}

type Options = {
  permission: LocationState;
  getPosition: () => Promise<Position | null>;
};

/**
 * The map opens on the fallback view straight away. If location is allowed, one position is
 * requested (it times out after 5 s in getPosition) and `myRegion` is set when it arrives, so
 * a slow or failing GPS never blocks the map.
 */
export function useInitialRegion({ permission, getPosition }: Options) {
  const [opening, setOpening] = useState<OpeningView | null>(null);
  const [myRegion, setMyRegion] = useState<MapRegion | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void readLastRegion().then((last) => {
      if (cancelled) return;
      let regionCode: string | null | undefined;
      try {
        regionCode = getLocales()[0]?.regionCode;
      } catch {
        regionCode = null;
      }
      setOpening(resolveFallbackView(last, regionCode));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (permission !== 'granted' || asked.current) return;
    asked.current = true;
    let cancelled = false;
    void getPosition().then((position) => {
      if (cancelled || !position) return;
      setMyRegion(regionAround(position.latitude, position.longitude));
    });
    return () => {
      cancelled = true;
      asked.current = false;
    };
  }, [permission, getPosition]);

  return { opening, myRegion };
}
