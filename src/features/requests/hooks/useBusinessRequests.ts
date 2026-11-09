import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listBusinessRequests, type RequestAppError } from '../api';
import type { InboxFilter, SellerRequest, SellerRequestList } from '../schema';

import { PENDING_POLL_MS, requestKeys } from './keys';
import { useRefetchAtExpiry } from './useRefetchAtExpiry';

/**
 * Where the next page starts: the server's own next_cursor text, "<created_at>|<id>", sent back
 * untouched (never parsed into a Date, which would cut its microseconds).
 */
export type InboxCursor = { before?: string };

type Pages = InfiniteData<SellerRequestList, InboxCursor>;

/** All loaded pages as one list in the server's order, each request once (first occurrence wins). */
export function flattenBusinessPages(data: Pages | undefined): SellerRequest[] {
  if (!data) return [];
  const seen = new Set<string>();
  const rows: SellerRequest[] = [];
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
 * The seller's inbox for one filter, newest first, 50 a page, paged by the server's cursor. Refetched
 * on app focus, every 30 s while a pending row is loaded, and just after one expires (server clock).
 * A refetch re-reads every loaded page. `refresh` (pull to refresh) goes back to page 1 only, and
 * only replaces the list once page 1 has loaded.
 */
export function useBusinessRequests(filter: InboxFilter) {
  const queryClient = useQueryClient();
  const key = requestKeys.inbox(filter);
  const query = useInfiniteQuery<
    SellerRequestList,
    RequestAppError,
    Pages,
    ReturnType<typeof requestKeys.inbox>,
    InboxCursor
  >({
    queryKey: key,
    initialPageParam: {},
    queryFn: ({ pageParam }) => listBusinessRequests(filter, pageParam.before),
    getNextPageParam: (last) => (last.next_cursor ? { before: last.next_cursor } : undefined),
    staleTime: 0,
    refetchInterval: (q) => (hasPending(q.state.data) ? PENDING_POLL_MS : false),
  });

  const requests = useMemo(() => flattenBusinessPages(query.data), [query.data]);
  const pending = useMemo(
    () => requests.filter((request) => request.display_status === 'pending'),
    [requests],
  );
  const serverNow = query.data?.pages[0]?.server_now;
  const { refetch } = query;
  useRefetchAtExpiry(pending, serverNow, query.dataUpdatedAt, () => {
    void refetch();
  });

  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshFailed(false);
    await queryClient.cancelQueries({ queryKey: key });
    try {
      const first = await listBusinessRequests(filter, undefined);
      queryClient.setQueryData<Pages>(key, { pages: [first], pageParams: [{}] });
    } catch {
      if (mounted.current) setRefreshFailed(true);
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [queryClient, key, filter]);

  return { ...query, requests, refresh, refreshing, refreshFailed };
}
