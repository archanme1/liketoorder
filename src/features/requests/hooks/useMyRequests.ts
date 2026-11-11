import type { InfiniteData } from '@tanstack/react-query';
import { useMemo } from 'react';

import { listMyRequests } from '../api';
import type { CustomerRequest, RequestFilter, RequestList } from '../schema';

import { mineKey } from './keys';
import { flattenRequestPages, usePagedRequests, type PagedCursor } from './usePagedRequests';

export type RequestsCursor = PagedCursor;

/** All loaded pages as one list, newest first, each request once (first occurrence wins). */
export function flattenPages(
  data: InfiniteData<RequestList, RequestsCursor> | undefined,
): CustomerRequest[] {
  return flattenRequestPages<CustomerRequest, RequestList>(data);
}

const nextCursor = (last: RequestList) => last.next_cursor ?? undefined;

/**
 * The caller's requests for one filter (default All), newest first, loaded 50 at a time as the list
 * is scrolled, paged by the server's own cursor ("<created_at>|<id>", sent back untouched). The
 * server applies the filter. Polled every 30 s: always on Pending (even when empty), otherwise
 * while a pending one is loaded. The paging itself is `usePagedRequests`.
 */
export function useMyRequests(options: { enabled?: boolean; filter?: RequestFilter } = {}) {
  const filter = options.filter ?? 'all';
  const queryKey = useMemo(() => mineKey(filter), [filter]);
  // All passes listMyRequests itself, so it is called with exactly one argument (the cursor), as
  // before spec 11c. Keep it: MyRequestsPagination and useMyRequestsPages assert that one argument.
  const fetchPage = useMemo(
    () =>
      filter === 'all'
        ? listMyRequests
        : (before: string | undefined) => listMyRequests(before, filter),
    [filter],
  );
  return usePagedRequests<CustomerRequest, RequestList>({
    queryKey,
    fetchPage,
    nextCursor,
    poll: filter === 'pending' ? 'always' : 'pending',
    enabled: options.enabled,
  });
}
