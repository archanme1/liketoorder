import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RequestAppError } from '../api';

import { PENDING_POLL_MS } from './keys';
import { useRefetchAtExpiry } from './useRefetchAtExpiry';

/**
 * Where the next page starts: the server's own cursor text, sent back untouched (never parsed into a
 * Date, which would cut its microseconds). An object, so the page param stays easy to extend.
 */
export type PagedCursor = { before?: string };

type PagedRow = { id: string; display_status: string; expires_at: string };
type Page<R extends PagedRow> = { server_now: string; requests: R[] };
type Pages<P> = InfiniteData<P, PagedCursor>;

/** All loaded pages as one list in the server's order, each request once (first occurrence wins). */
export function flattenRequestPages<R extends PagedRow, P extends Page<R>>(
  data: Pages<P> | undefined,
): R[] {
  if (!data) return [];
  const seen = new Set<string>();
  const rows: R[] = [];
  for (const page of data.pages) {
    for (const request of page.requests) {
      if (seen.has(request.id)) continue;
      seen.add(request.id);
      rows.push(request);
    }
  }
  return rows;
}

const hasPending = <R extends PagedRow, P extends Page<R>>(data: Pages<P> | undefined) =>
  data?.pages.some((page) => page.requests.some((r) => r.display_status === 'pending')) ?? false;

type Options<R extends PagedRow, P extends Page<R>> = {
  queryKey: QueryKey;
  /** One page, starting after `before` (undefined for the newest). */
  fetchPage: (before: string | undefined) => Promise<P>;
  /** The cursor for the page after `last`, or undefined when `last` was the final page. */
  nextCursor: (last: P) => string | undefined;
  /** 'always' polls even when nothing is pending (an empty Waiting list); 'pending' only while a pending row is loaded. */
  poll: 'always' | 'pending';
  enabled?: boolean;
};

/**
 * The one pager behind every request list: newest first, 50 a page, loaded as the list is scrolled.
 * Refetched on app focus, every 30 s (see `poll`), and just after a loaded pending row expires
 * (server clock). A refetch re-reads every loaded page, each page's cursor taken from the page just
 * fetched, so a request added meanwhile shifts rows between pages without losing or repeating any.
 * `refresh` (pull to refresh) goes back to page 1 only, and only replaces the list once page 1 has
 * loaded, so a failure leaves every loaded page where it was.
 */
export function usePagedRequests<R extends PagedRow, P extends Page<R>>(options: Options<R, P>) {
  const { queryKey, fetchPage, nextCursor, poll, enabled } = options;
  const queryClient = useQueryClient();
  const query = useInfiniteQuery<P, RequestAppError, Pages<P>, QueryKey, PagedCursor>({
    queryKey,
    initialPageParam: {},
    queryFn: ({ pageParam }) => fetchPage(pageParam.before),
    getNextPageParam: (last) => {
      const before = nextCursor(last);
      return before ? { before } : undefined;
    },
    staleTime: 0,
    enabled: enabled ?? true,
    refetchInterval: (q) =>
      poll === 'always' || hasPending(q.state.data) ? PENDING_POLL_MS : false,
  });

  const requests = useMemo(() => flattenRequestPages<R, P>(query.data), [query.data]);
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
    // A next-page or background read still running would answer for the list we are replacing.
    await queryClient.cancelQueries({ queryKey });
    try {
      const first = await fetchPage(undefined);
      queryClient.setQueryData<Pages<P>>(queryKey, { pages: [first], pageParams: [{}] });
    } catch {
      if (mounted.current) setRefreshFailed(true);
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [queryClient, queryKey, fetchPage]);

  return { ...query, requests, refresh, refreshing, refreshFailed };
}
