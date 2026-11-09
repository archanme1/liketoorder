import { useQuery } from '@tanstack/react-query';

import { getBusinessRequest, type RequestAppError } from '../api';
import type { SellerRequestDetail } from '../schema';

import { PENDING_POLL_MS, requestKeys } from './keys';
import { useRefetchAtExpiry } from './useRefetchAtExpiry';

/** A request to the caller's business. `data.request === null` means not found (unknown or not theirs). */
export function useBusinessRequest(id: string) {
  const query = useQuery<SellerRequestDetail, RequestAppError>({
    queryKey: requestKeys.businessDetail(id),
    queryFn: () => getBusinessRequest(id),
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
