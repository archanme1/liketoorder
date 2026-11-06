import { keepPreviousData, useQuery, type Query } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { fetchPinsInBounds, MapAppError } from '../api';
import { roundBox, type MapBox } from '../region';
import type { Pin, PinsResponse } from '../schema';

export const pinsKey = (box: MapBox) => ['map', 'pins', box] as const;

const EMPTY_PINS: Pin[] = [];

const NO_RETRY: ReadonlySet<string> = new Set(['rate_limited', 'invalid_bounds']);

// A failed query is only ever retried by the person (Retry / moving the map). Focus, reconnect
// and remounting never re-send a failed request, so a rate limit can't turn into a loop.
const unlessFailed = (query: Query<PinsResponse, MapAppError>) => query.state.status !== 'error';

/**
 * Pins for the settled map box. The key holds the rounded box, so only the latest box is
 * rendered and a late answer for an old area is dropped. Old pins stay on screen while the next
 * area loads, and after a failure.
 */
export function usePinsInBounds(box: MapBox | null) {
  const rounded = useMemo(() => (box ? roundBox(box) : null), [box]);

  const query = useQuery<PinsResponse, MapAppError>({
    queryKey: rounded ? pinsKey(rounded) : ['map', 'pins', 'none'],
    queryFn: () => {
      if (!rounded) throw new MapAppError('unknown');
      return fetchPinsInBounds(rounded);
    },
    enabled: rounded !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: (failureCount, error) => !NO_RETRY.has(error.code) && failureCount < 1,
    refetchOnWindowFocus: unlessFailed,
    refetchOnReconnect: unlessFailed,
    refetchOnMount: unlessFailed,
  });

  // The last good answer, kept so a failure for a new area doesn't empty the map (react-query
  // drops the placeholder data once the new query errors).
  const [lastGood, setLastGood] = useState<PinsResponse | null>(null);
  if (query.data && !query.isPlaceholderData && query.data !== lastGood) {
    setLastGood(query.data);
  }
  // While loading, keepPreviousData supplies the old pins; after a failure, the last good answer.
  const shown = query.data ?? (query.isError ? lastGood : null);

  const retry = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    pins: shown?.pins ?? EMPTY_PINS,
    capped: shown?.capped ?? false,
    tooLarge: shown?.too_large ?? false,
    hasData: shown !== null,
    isFetching: query.isFetching,
    error: query.isError ? query.error : null,
    retry,
  };
}
