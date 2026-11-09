import type { QueryClient } from '@tanstack/react-query';

import { requestKeys } from './keys';

/** Re-reads everything a seller action can change: the inbox (every filter), the request, the count. */
export function invalidateSellerRequests(queryClient: QueryClient, requestId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: requestKeys.inboxAll }),
    queryClient.invalidateQueries({ queryKey: requestKeys.businessDetail(requestId) }),
    queryClient.invalidateQueries({ queryKey: requestKeys.waitingCount }),
  ]);
}
