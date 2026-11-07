import { useQuery } from '@tanstack/react-query';

import { getPickupRequest, type RequestAppError } from '../api';
import type { RequestDetail } from '../schema';

import { PENDING_POLL_MS, requestKeys } from './keys';
import { useRefetchAtExpiry } from './useRefetchAtExpiry';

/** One of the caller's requests. `data.request === null` means not found (unknown or not theirs). */
export function usePickupRequest(id: string) {
  const query = useQuery<RequestDetail, RequestAppError>({
    queryKey: requestKeys.detail(id),
    queryFn: () => getPickupRequest(id),
    staleTime: 0,
    refetchInterval: (q) =>
      q.state.data?.request?.display_status === 'pending' ? PENDING_POLL_MS : false,
  });
  const request = query.data?.request ?? null;
  const pending = request?.display_status === 'pending' ? [request] : [];
  useRefetchAtExpiry(pending, query.data?.server_now, query.dataUpdatedAt, () => {
    void query.refetch();
  });
  return query;
}
