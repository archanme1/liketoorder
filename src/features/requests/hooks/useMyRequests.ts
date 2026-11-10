import type { InfiniteData } from '@tanstack/react-query';

import { listMyRequests } from '../api';
import type { PickupRequest, RequestList } from '../schema';

import { requestKeys } from './keys';
import { flattenRequestPages, usePagedRequests, type PagedCursor } from './usePagedRequests';

export type RequestsCursor = PagedCursor;

/** All loaded pages as one list, newest first, each request once (first occurrence wins). */
export function flattenPages(
  data: InfiniteData<RequestList, RequestsCursor> | undefined,
): PickupRequest[] {
  return flattenRequestPages<PickupRequest, RequestList>(data);
}

const nextCursor = (last: RequestList) => last.next_cursor ?? undefined;

/**
 * The caller's requests, newest first, loaded 50 at a time as the list is scrolled, paged by the
 * server's own cursor ("<created_at>|<id>", sent back untouched). Polled every 30 s while a pending
 * one is loaded. The paging itself is `usePagedRequests`.
 */
export function useMyRequests(options: { enabled?: boolean } = {}) {
  return usePagedRequests<PickupRequest, RequestList>({
    queryKey: requestKeys.mine,
    fetchPage: listMyRequests,
    nextCursor,
    poll: 'pending',
    enabled: options.enabled,
  });
}
