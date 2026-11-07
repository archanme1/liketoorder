import { useQuery, type Query } from '@tanstack/react-query';

import { fetchHomemadeDetails, MapAppError } from '../api';
import type { HomemadeDetails } from '../schema';

export const homemadeDetailsKey = (id: string) => ['map', 'homemade', 'details', id] as const;

const NO_RETRY: ReadonlySet<string> = new Set(['rate_limited', 'invalid_bounds']);
type DetailsQuery = Query<HomemadeDetails | null, MapAppError>;
// A failed lookup is only re-sent by the person (Retry), never by focus, reconnect or remount.
const unlessFailed = (query: DetailsQuery) => query.state.status !== 'error';

/**
 * One cook for the sheet. `data === null` means "not available right now" (a normal answer, not
 * an error); `undefined` means still loading.
 */
export function useHomemadeDetails(id: string | null) {
  return useQuery<HomemadeDetails | null, MapAppError>({
    queryKey: homemadeDetailsKey(id ?? 'none'),
    queryFn: () => {
      if (!id) throw new MapAppError('unknown');
      return fetchHomemadeDetails(id);
    },
    enabled: id !== null,
    staleTime: 5 * 60_000,
    retry: (failureCount, error) => !NO_RETRY.has(error.code) && failureCount < 1,
    refetchOnWindowFocus: unlessFailed,
    refetchOnReconnect: unlessFailed,
    refetchOnMount: unlessFailed,
  });
}
