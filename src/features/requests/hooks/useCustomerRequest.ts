import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { getMyTableRequest, getPickupRequest, type RequestAppError } from '../api';
import type { RequestKind } from '../kind';
import type { RequestDetail } from '../schema';

import { PENDING_POLL_MS, requestKeys } from './keys';
import { flattenPages } from './useMyRequests';
import { useRefetchAtExpiry } from './useRefetchAtExpiry';

const READ: Record<RequestKind, (id: string) => Promise<RequestDetail>> = {
  pickup: getPickupRequest,
  table: getMyTableRequest,
};

/** The kind of a request already in the loaded Sent list, if it is there. */
function cachedKind(queryClient: QueryClient, id: string): RequestKind | null {
  const pages = queryClient.getQueryData<Parameters<typeof flattenPages>[0]>(requestKeys.mine);
  return flattenPages(pages).find((request) => request.id === id)?.kind ?? null;
}

/**
 * One of the caller's requests, pickup or table. Which of the two server reads to use comes from
 * `hint` (the kind the list row carried, passed as a route parameter), else from the row in the
 * loaded Sent list, else both are tried, pickup first. The hint only chooses a read: the server
 * answers for the caller's own requests only, and `request === null` means not found (unknown,
 * someone else's, or the wrong kind) whatever was guessed.
 */
export function useCustomerRequest(id: string, hint: RequestKind | null = null) {
  const queryClient = useQueryClient();
  const query = useQuery<RequestDetail, RequestAppError>({
    queryKey: requestKeys.detail(id),
    queryFn: async () => {
      const known = hint ?? cachedKind(queryClient, id);
      if (known) return READ[known](id);
      const asPickup = await READ.pickup(id);
      return asPickup.request ? asPickup : READ.table(id);
    },
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
