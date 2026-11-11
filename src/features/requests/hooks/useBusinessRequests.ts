import type { InfiniteData } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { listBusinessRequests } from '../api';
import type { BusinessRequest, RequestFilter, SellerRequestList } from '../schema';

import { requestKeys } from './keys';
import { flattenRequestPages, usePagedRequests, type PagedCursor } from './usePagedRequests';

export type InboxCursor = PagedCursor;

/** All loaded pages as one list in the server's order, each request once (first occurrence wins). */
export function flattenBusinessPages(
  data: InfiniteData<SellerRequestList, InboxCursor> | undefined,
): BusinessRequest[] {
  return flattenRequestPages<BusinessRequest, SellerRequestList>(data);
}

const nextCursor = (last: SellerRequestList) => last.next_cursor ?? undefined;

/**
 * The seller's inbox for one filter, newest first, 50 a page, paged by the server's cursor
 * ("<created_at>|<id>", sent back untouched). The server applies the filter. Polled every 30 s:
 * always on Pending (even when empty: nothing pushes a new request until spec 12, and an empty
 * Pending list is where a seller sits and waits), on the others only while a pending row is
 * loaded. The paging itself is `usePagedRequests`.
 */
export function useBusinessRequests(filter: RequestFilter) {
  const queryKey = useMemo(() => requestKeys.inbox(filter), [filter]);
  const fetchPage = useCallback(
    (before: string | undefined) => listBusinessRequests(filter, before),
    [filter],
  );
  return usePagedRequests<BusinessRequest, SellerRequestList>({
    queryKey,
    fetchPage,
    nextCursor,
    poll: filter === 'pending' ? 'always' : 'pending',
  });
}
