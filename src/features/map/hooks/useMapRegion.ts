import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { REGION_KEY, saveLastRegion } from '../lastRegion';
import { regionToBox, type MapBox, type MapRegion } from '../region';

/** Wait this long after the person stops moving the map before asking for pins. */
export const REGION_DEBOUNCE_MS = 400;

/**
 * Turns the map's "moved" events into one settled region and its box.
 * - `region` updates on every completed move (clusters and notices use it).
 * - `box` follows `region` only after the person stops for 400 ms, so a pan sends one request.
 *   The first region (the opening view) settles at once so pins load straight away.
 * - The settled region is saved on the phone as the last viewed region.
 */
export function useMapRegion(initial: MapRegion | null, regionKey: string = REGION_KEY) {
  const [region, setRegion] = useState<MapRegion | null>(null);
  const [settled, setSettled] = useState<MapRegion | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hasSettledOnce = useRef(false);

  const settle = useCallback(
    (next: MapRegion) => {
      hasSettledOnce.current = true;
      setSettled(next);
      void saveLastRegion(next, regionKey);
    },
    [regionKey],
  );

  // The opening view counts as the first region.
  useEffect(() => {
    if (initial && !hasSettledOnce.current) {
      setRegion(initial);
      hasSettledOnce.current = true;
      setSettled(initial);
    }
  }, [initial]);

  const onRegionChangeComplete = useCallback(
    (next: MapRegion) => {
      setRegion(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => settle(next), REGION_DEBOUNCE_MS);
    },
    [settle],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const box = useMemo<MapBox | null>(() => (settled ? regionToBox(settled) : null), [settled]);
  return { region, settledRegion: settled, box, onRegionChangeComplete };
}
