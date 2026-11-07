import { useQuery } from '@tanstack/react-query';

import { listMyPickupRequests, type RequestAppError } from '../api';
import type { RequestList } from '../schema';

import { PENDING_POLL_MS, requestKeys } from './keys';
import { useRefetchAtExpiry } from './useRefetchAtExpiry';

/**
 * The caller's requests, newest first (one page of 50). Refetched on app focus, every 30 s while
 * a pending one is visible, and just after the earliest one expires (server clock).
 */
export function useMyRequests() {
  const query = useQuery<RequestList, RequestAppError>({
    queryKey: requestKeys.mine,
    queryFn: () => listMyPickupRequests(),
    staleTime: 0,
    refetchInterval: (q) =>
      q.state.data?.requests.some((r) => r.display_status === 'pending') ? PENDING_POLL_MS : false,
  });
  const pending = query.data?.requests.filter((r) => r.display_status === 'pending') ?? [];
  useRefetchAtExpiry(pending, query.data?.server_now, query.dataUpdatedAt, () => {
    void query.refetch();
  });
  return query;
}
