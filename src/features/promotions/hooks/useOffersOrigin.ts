import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLocationPermission, type Position } from '@/features/map/hooks/useLocationPermission';
import { HOMEMADE_REGION_KEY, readLastRegion, REGION_KEY } from '@/features/map/lastRegion';
import { snapPoint, type SnappedPoint } from '@/features/map/region';

import type { Origin } from '../distance';
import { LAUNCH_AREA } from '../launchArea';
import {
  fallbackArea,
  type AreaReason,
  type AreaSource,
  type FallbackArea,
  type OriginKind,
} from '../offersArea';

/** What the person picked in Change area; 'auto' until they pick (my location when allowed). */
export type AreaChoice = 'auto' | 'me' | AreaSource;

export type OffersOrigin =
  | { status: 'loading' }
  | {
      status: 'ready';
      kind: OriginKind;
      /** Where distances are measured from: the real position, or the area's centre. Phone only. */
      position: Origin;
      /** The only form of it that is sent. */
      point: SnappedPoint;
      /** Why the person's own position is not in use (null when it is, or an area was picked). */
      reason: AreaReason | null;
    };

type Fix = 'idle' | 'failed';

/**
 * Spec 16 Offers: where the list looks (Decision D2, Resolved Q14).
 *
 * 1. Location already allowed: one position (5 s at most). Late or failed: the fallback area.
 * 2. Never asked: the fallback area at once, while the screen shows the note with "Use my
 *    location" (the same note and "Not now" flag as the maps).
 * 3. Denied, denied for ever or Location Services off: the fallback area ("Location is off").
 * 4. The fallback area: the last Restaurants map view, then the last Homemade one, then the
 *    launch area. The saved views are read here and never written.
 * 5. Change area: my location (asks the system again when it still can), the last map view or
 *    the launch area. Kept for this screen only, never stored.
 *
 * The exact position lives only in this hook's state. It is never stored, logged, put in a query
 * key or a route, or sent: only `point` (snapPoint) leaves the phone.
 */
export function useOffersOrigin() {
  const { state, showPrompt, request, refresh, getPosition, dismissPrompt } =
    useLocationPermission();
  const [fallback, setFallback] = useState<FallbackArea | null>(null);
  const [choice, setChoice] = useState<AreaChoice>('auto');
  const [position, setPosition] = useState<Position | null>(null);
  const [fix, setFix] = useState<Fix>('idle');

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    void Promise.all([readLastRegion(REGION_KEY), readLastRegion(HOMEMADE_REGION_KEY)]).then(
      ([restaurants, homemade]) => {
        if (mounted.current) setFallback(fallbackArea(restaurants, homemade));
      },
    );
  }, []);

  // Allowed (now, or later from Settings) and no position yet: ask for one (5 s at most). State is
  // set only when the answer comes back; until then the origin is "loading".
  const wantsMe = choice === 'auto' || choice === 'me';
  const asking = useRef(false);
  useEffect(() => {
    if (state !== 'granted' || !wantsMe || position !== null || fix !== 'idle' || asking.current) {
      return;
    }
    asking.current = true;
    void getPosition().then((next) => {
      asking.current = false;
      if (!mounted.current) return;
      if (next) setPosition(next);
      else setFix('failed');
    });
  }, [state, wantsMe, position, fix, getPosition]);

  /** "Use my location" (the note or Change area): asks the system when it still can. */
  const chooseMyLocation = useCallback(async () => {
    setChoice('me');
    let next = await refresh();
    if (next === 'undetermined' || next === 'denied') next = await request();
    if (!mounted.current) return;
    if (next === 'granted') {
      // A fresh position, even if an older one is known.
      setPosition(null);
      setFix('idle');
    }
  }, [refresh, request]);

  const chooseArea = useCallback((source: AreaSource) => setChoice(source), []);

  // Worked out from state only: nothing about the position is kept anywhere else.
  const origin = useMemo((): OffersOrigin => {
    if (state === 'unknown' || fallback === null) return { status: 'loading' };
    const mePoint = position ? snapPoint(position.latitude, position.longitude) : null;
    if (wantsMe && state === 'granted' && position && mePoint) {
      return { status: 'ready', kind: 'me', position, point: mePoint, reason: null };
    }
    if (wantsMe && state === 'granted' && fix !== 'failed' && !position) {
      return { status: 'loading' };
    }
    const source: AreaSource =
      choice === 'launch' ? 'launch' : fallback.source === 'last_map' ? 'last_map' : 'launch';
    const centre: Origin =
      source === 'launch'
        ? { latitude: LAUNCH_AREA.latitude, longitude: LAUNCH_AREA.longitude }
        : { latitude: fallback.latitude, longitude: fallback.longitude };
    const point = snapPoint(centre.latitude, centre.longitude);
    if (!point) return { status: 'loading' };
    const reason: AreaReason | null = !wantsMe
      ? null
      : state === 'granted'
        ? 'no_fix'
        : state === 'undetermined'
          ? 'not_asked'
          : 'location_off';
    return { status: 'ready', kind: source, position: centre, point, reason };
  }, [state, fallback, position, wantsMe, fix, choice]);

  /**
   * Pull to refresh: a new position when the list is near the person. True when the grid point
   * changed (the list then reloads under its new key by itself).
   */
  const refreshPosition = useCallback(async (): Promise<boolean> => {
    if (origin.status !== 'ready' || origin.kind !== 'me') return false;
    const before = origin.point;
    const next = await getPosition();
    if (!next || !mounted.current) return false;
    const after = snapPoint(next.latitude, next.longitude);
    setPosition(next);
    return after !== null && (after.lat !== before.lat || after.lng !== before.lng);
  }, [origin, getPosition]);

  return {
    origin,
    choice,
    /** The saved map view can be offered in Change area. */
    hasLastMap: fallback?.source === 'last_map',
    permission: state,
    /** Only Settings can turn location back on. */
    settingsOnly: state === 'denied_forever' || state === 'services_off',
    showPrompt,
    dismissPrompt,
    chooseMyLocation,
    chooseArea,
    refreshPosition,
  };
}
