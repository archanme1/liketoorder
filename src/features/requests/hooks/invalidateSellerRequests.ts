import type { QueryClient } from '@tanstack/react-query';

import type { BusinessRequest, SellerRequestDetail } from '../schema';

import { requestKeys } from './keys';

/** Re-reads everything a seller action can change: the inbox (every filter), the request, the count, the Sent list. */
export function invalidateSellerRequests(queryClient: QueryClient, requestId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: requestKeys.inboxAll }),
    queryClient.invalidateQueries({ queryKey: requestKeys.businessDetail(requestId) }),
    queryClient.invalidateQueries({ queryKey: requestKeys.waitingCount }),
    // The customer's own list (and the badge made from it) when seller and customer are one person.
    queryClient.invalidateQueries({ queryKey: requestKeys.mine }),
  ]);
}

/**
 * Shows the server's answer on the open request straight away. The answer carries no server_now, so
 * the cached server_now stays and so does the time it was fetched (`updatedAt`): the pair is what
 * the clock offset (pickup hint, expiry timer) is worked out from, and changing only one of them
 * would skew it until the refetch that follows.
 */
export function writeAnswer(queryClient: QueryClient, requestId: string, request: BusinessRequest) {
  const key = requestKeys.businessDetail(requestId);
  const fetchedAt = queryClient.getQueryState<SellerRequestDetail>(key)?.dataUpdatedAt;
  queryClient.setQueryData<SellerRequestDetail>(
    key,
    (old) => (old ? { ...old, request } : old),
    fetchedAt ? { updatedAt: fetchedAt } : undefined,
  );
}
