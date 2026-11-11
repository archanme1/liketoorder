import type { RequestFilter } from '../schema';

export const requestKeys = {
  all: ['requests'] as const,
  // Sent: All is `mine` itself (the badge reads it too); a filtered list sits under it, so
  // invalidating `mine` re-reads every filter.
  mine: ['requests', 'mine'] as const,
  mineFiltered: (filter: Exclude<RequestFilter, 'all'>) => ['requests', 'mine', filter] as const,
  detail: (id: string) => ['requests', 'detail', id] as const,
  address: (id: string) => ['requests', 'address', id] as const,
  // Seller side (spec 10).
  inboxAll: ['requests', 'inbox'] as const,
  inbox: (filter: RequestFilter) => ['requests', 'inbox', filter] as const,
  businessDetail: (id: string) => ['requests', 'businessDetail', id] as const,
  waitingCount: ['requests', 'waitingCount'] as const,
};

/** The query key of one Sent list. */
export function mineKey(filter: RequestFilter) {
  return filter === 'all' ? requestKeys.mine : requestKeys.mineFiltered(filter);
}

/** A pending request on screen is re-read this often, so an answer or an expiry shows up. */
export const PENDING_POLL_MS = 30_000;
