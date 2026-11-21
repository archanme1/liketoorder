import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { offersKeyRoot } from '@/features/promotions/hooks/useOffers';

import type { OfferTarget } from '../offerTarget';
import { regionForPick, type MapRegion } from '../region';
import type { Pin } from '../schema';

/** What card to map needs from a place's details: the same answer the sheet body reads. */
export type OfferDetails = { name: string; cuisine_code: string; sponsored: boolean } | null;

type Options = {
  target: OfferTarget | null;
  /** The map can take camera moves (onMapReady). */
  ready: boolean;
  /** The tab's details query key and fetcher, so the fresh answer also feeds the sheet. */
  detailsKey: (id: string) => QueryKey;
  fetchDetails: (id: string) => Promise<OfferDetails>;
  /** The pins loaded for the map's area. */
  pins: readonly Pin[];
  moveTo: (region: MapRegion) => void;
  currentRegion: () => MapRegion | null;
  /** Opens the sheet on this place. */
  open: (pin: Pin) => void;
  /** The target was taken in: clear the route params, so a refocus does not open it again. */
  onHandled: () => void;
};

const keyOf = (target: OfferTarget) => `${target.business}|${target.lat}|${target.lng}`;

/**
 * Spec 16 Decision D15, card to map. Once per target and once the map is ready:
 * 1. the camera moves to the place's public point, above the half-open sheet (Reduce Motion: no
 *    animation, through moveTo);
 * 2. the details are read fresh (staleTime 0): a cached answer could still say "sponsored";
 * 3. null (not available): no sheet, the ended message, and Offers is refreshed;
 *    not sponsored any more: the sheet and the ended message, and Offers is refreshed;
 *    sponsored: the sheet. The sheet opens on the loaded pin, or on a pin built from the details
 *    when that area's pins have not loaded yet;
 * 4. a failed read opens the sheet on the place's pin, now or as soon as that area's pins load
 *    (the sheet then shows its own error and Retry).
 *
 * `cameraTaken` turns true at step 1, so a late "my position" fix does not pull the camera away.
 */
export function useOfferTarget({
  target,
  ready,
  detailsKey,
  fetchDetails,
  pins,
  moveTo,
  currentRegion,
  open,
  onHandled,
}: Options) {
  const queryClient = useQueryClient();
  const [ended, setEnded] = useState(false);
  const cameraTaken = useRef(false);
  const handled = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The latest inputs, so the effect below runs once per target, not on every render.
  const latest = useRef({ detailsKey, fetchDetails, pins, moveTo, currentRegion, open, onHandled });
  useEffect(() => {
    latest.current = { detailsKey, fetchDetails, pins, moveTo, currentRegion, open, onHandled };
  });

  // A place whose details could not be read before its pin loaded: opened when the pin arrives.
  const waiting = useRef<string | null>(null);
  useEffect(() => {
    const id = waiting.current;
    if (!id) return;
    const pin = pins.find((candidate) => candidate.id === id);
    if (!pin) return;
    waiting.current = null;
    latest.current.open(pin);
  }, [pins]);

  useEffect(() => {
    if (!target) {
      // Cleared: the same card can open the same place again.
      handled.current = null;
      return;
    }
    if (!ready || handled.current === keyOf(target)) return;
    handled.current = keyOf(target);
    waiting.current = null;
    const run = latest.current;
    const { business: id, lat, lng } = target;
    const findPin = () => latest.current.pins.find((pin) => pin.id === id);

    cameraTaken.current = true;
    run.moveTo(regionForPick({ lat, lng }, run.currentRegion()));

    void queryClient
      .fetchQuery<OfferDetails>({
        queryKey: run.detailsKey(id),
        queryFn: () => run.fetchDetails(id),
        staleTime: 0,
        retry: false,
      })
      .then((details) => {
        if (!mounted.current) return;
        const gone = details === null || !details.sponsored;
        setEnded(gone);
        if (gone) void queryClient.invalidateQueries({ queryKey: offersKeyRoot });
        if (details === null) return;
        latest.current.open(
          findPin() ?? {
            id,
            name: details.name,
            cuisine_code: details.cuisine_code,
            lat,
            lng,
            promoted: details.sponsored,
          },
        );
      })
      .catch(() => {
        if (!mounted.current) return;
        const pin = findPin();
        if (pin) latest.current.open(pin);
        else waiting.current = id;
      });
    run.onHandled();
  }, [target, ready, queryClient]);

  const dismissEnded = useCallback(() => setEnded(false), []);

  return { ended, dismissEnded, cameraTaken };
}
