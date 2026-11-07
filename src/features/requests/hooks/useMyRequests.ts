import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { listMyPickupRequests, type RequestAppError } from '../api';
import { PAGE_SIZE, type PickupRequest, type RequestList } from '../schema';

import { PENDING_POLL_MS, requestKeys } from './keys';
import { useRefetchAtExpiry } from './useRefetchAtExpiry';

/**
 * Where the next page starts: rows created before this. Kept as the server's own text (never
 * parsed into a Date) so its microseconds survive the round trip. An object, so a tie-breaking id
 * can be added when the cursor becomes (created_at, id).
 */
export type RequestsCursor = { before?: string };

type Pages = InfiniteData<RequestList, RequestsCursor>;

/** All loaded pages as one list, newest first, each request once (first occurrence wins). */
export function flattenPages(data: Pages | undefined): PickupRequest[] {
  if (!data) return [];
  const seen = new Set<string>();
  const rows: PickupRequest[] = [];
  for (const page of data.pages) {
    for (const request of page.requests) {
      if (seen.has(request.id)) continue;
      seen.add(request.id);
      rows.push(request);
    }
  }
  return rows;
}

const hasPending = (data: Pages | undefined) =>
  data?.pages.some((page) => page.requests.some((r) => r.display_status === 'pending')) ?? false;

/**
 * The caller's requests, newest first, loaded 50 at a time as the list is scrolled. Refetched on
 * app focus, every 30 s while a pending one is loaded, and just after one expires (server
 * clock). A refetch re-reads every loaded page, each page's cursor taken from the page just
 * fetched, so a request added meanwhile shifts rows between pages without losing or repeating
 * any. `refresh` (pull to refresh) goes back to page 1 only.
 */
export function useMyRequests() {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery<
    RequestList,
    RequestAppError,
    Pages,
    typeof requestKeys.mine,
    RequestsCursor
  >({
    queryKey: requestKeys.mine,
    initialPageParam: {},
    queryFn: ({ pageParam }) => listMyPickupRequests(pageParam.before),
    getNextPageParam: (last) =>
      last.requests.length >= PAGE_SIZE
        ? { before: last.requests[last.requests.length - 1].created_at }
        : undefined,
    staleTime: 0,
    refetchInterval: (q) => (hasPending(q.state.data) ? PENDING_POLL_MS : false),
  });

  const requests = useMemo(() => flattenPages(query.data), [query.data]);
  const pending = useMemo(
    () => requests.filter((request) => request.display_status === 'pending'),
    [requests],
  );
  // The newest page is the freshest answer about pending rows, so its clock times the refetch.
  const serverNow = query.data?.pages[0]?.server_now;
  const { refetch } = query;
  useRefetchAtExpiry(pending, serverNow, query.dataUpdatedAt, () => {
    void refetch();
  });

  const refresh = useCallback(async () => {
    queryClient.setQueryData<Pages>(requestKeys.mine, (data) =>
      data ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) } : data,
    );
    await refetch();
  }, [queryClient, refetch]);

  return { ...query, requests, refresh };
}
