import { useQuery, type Query } from '@tanstack/react-query';

import { fetchRestaurantDetails, MapAppError } from '../api';
import type { RestaurantDetails } from '../schema';

export const detailsKey = (id: string) => ['map', 'details', id] as const;

const NO_RETRY: ReadonlySet<string> = new Set(['rate_limited', 'invalid_bounds']);
type DetailsQuery = Query<RestaurantDetails | null, MapAppError>;
// A failed lookup is only re-sent by the person (Retry), never by focus, reconnect or remount.
const unlessFailed = (query: DetailsQuery) => query.state.status !== 'error';

/**
 * One restaurant for the sheet. `data === null` means "not available right now" (a normal
 * answer, not an error); `undefined` means still loading.
 */
export function useRestaurantDetails(id: string | null) {
  return useQuery<RestaurantDetails | null, MapAppError>({
    queryKey: detailsKey(id ?? 'none'),
    queryFn: () => {
      if (!id) throw new MapAppError('unknown');
      return fetchRestaurantDetails(id);
    },
    enabled: id !== null,
    staleTime: 5 * 60_000,
    retry: (failureCount, error) => !NO_RETRY.has(error.code) && failureCount < 1,
    refetchOnWindowFocus: unlessFailed,
    refetchOnReconnect: unlessFailed,
    refetchOnMount: unlessFailed,
  });
}

/**
 * Spec 16: whether the open place's details say it is sponsored, for the sheet header. The same
 * query as the sheet body (shared cache, no extra request). False once the details say the place
 * is not available (null); undefined (unknown) while they load or when the request failed, so the
 * sheet then falls back to the pin's own flag.
 */
export function useRestaurantSponsored(id: string | null): boolean | undefined {
  const { data } = useRestaurantDetails(id);
  if (data === null) return false;
  return data?.sponsored;
}
