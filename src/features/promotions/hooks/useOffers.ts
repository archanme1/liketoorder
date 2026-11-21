import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SnappedPoint } from '@/features/map/region';

import { fetchOffersNear, OfferAppError, type OfferErrorCode } from '../api';
import type { Offer, OfferFilters, OffersPage } from '../schema';

/** Everything Offers caches. Invalidated when card to map finds an offer has ended. */
export const offersKeyRoot = ['offers'] as const;

/** One list: the grid point (never the raw position) and the filters. */
export const offersKey = (point: SnappedPoint, filters: OfferFilters) =>
  [
    ...offersKeyRoot,
    'list',
    point.lat,
    point.lng,
    filters.distanceKm,
    filters.category ?? 'all',
    filters.type ?? 'all',
    filters.tables,
  ] as const;

/** About the time the map takes to drop an ended campaign's flag (spec 16 overview). */
export const OFFERS_STALE_MS = 60_000;

// A slow or broken connection is tried once more. A refusal (rate limit, a bad request) only by the
// person (Retry), never on its own.
const RETRY_ONCE: ReadonlySet<OfferErrorCode> = new Set(['network', 'unknown']);

type Cursor = string | null;
type Pages = InfiniteData<OffersPage, Cursor>;

/** All loaded pages as one list in the server's order, each business once (first wins). */
export function flattenOffers(data: Pages | undefined): Offer[] {
  if (!data) return [];
  const seen = new Set<string>();
  const offers: Offer[] = [];
  for (const page of data.pages) {
    for (const offer of page.offers) {
      if (seen.has(offer.business_id)) continue;
      seen.add(offer.business_id);
      offers.push(offer);
    }
  }
  return offers;
}

/**
 * Active promotions near a grid point, 20 a page, loaded as the list is scrolled.
 *
 * - The key holds the snapped point and the filters, so a new area or filter is a new list.
 * - A refetch (stale on focus) re-reads every loaded page, each cursor taken from the page just
 *   fetched, so all pages then share one UTC day's order.
 * - `loadMore` sends the last page's cursor untouched. The cursor carries its own day, so a list
 *   started before UTC midnight continues in that day's order. If the server ever refuses the
 *   cursor (more than a day old), the list quietly starts again at page 1, once.
 * - `refresh` (pull to refresh) goes back to page 1 only, and replaces the list only once page 1
 *   has loaded, so a failure leaves the loaded list where it was.
 */
export function useOffers(point: SnappedPoint | null, filters: OfferFilters) {
  const queryClient = useQueryClient();
  const queryKey: QueryKey = point ? offersKey(point, filters) : [...offersKeyRoot, 'list', 'none'];

  const query = useInfiniteQuery<OffersPage, OfferAppError, Pages, QueryKey, Cursor>({
    queryKey,
    initialPageParam: null,
    queryFn: ({ pageParam }) => {
      if (!point) throw new OfferAppError('unknown');
      return fetchOffersNear(point, filters, pageParam);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: point !== null,
    staleTime: OFFERS_STALE_MS,
    retry: (failureCount, error) => RETRY_ONCE.has(error.code) && failureCount < 1,
  });

  const offers = useMemo(() => flattenOffers(query.data), [query.data]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  // The point and filters behind the current key, read when refresh runs.
  const latest = useRef({ point, filters, queryKey });
  useEffect(() => {
    latest.current = { point, filters, queryKey };
  });

  const refresh = useCallback(async (): Promise<boolean> => {
    const { point: at, filters: current, queryKey: key } = latest.current;
    if (!at) return false;
    setRefreshing(true);
    setRefreshFailed(false);
    // A next-page or background read still running would answer for the list being replaced.
    await queryClient.cancelQueries({ queryKey: key });
    try {
      const first = await fetchOffersNear(at, current, null);
      queryClient.setQueryData<Pages>(key, { pages: [first], pageParams: [null] });
      return true;
    } catch {
      if (mounted.current) setRefreshFailed(true);
      return false;
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [queryClient]);

  // One quiet restart per run of refused cursors, so a server that keeps refusing never loops.
  const restarted = useRef(false);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const loadMore = useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage) return;
    const result = await fetchNextPage();
    if (result.error?.code === 'invalid_cursor' && !restarted.current) {
      restarted.current = true;
      await refresh();
      return;
    }
    if (!result.error) restarted.current = false;
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, refresh]);

  return { ...query, offers, refresh, refreshing, refreshFailed, loadMore };
}
