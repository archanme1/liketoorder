export const requestKeys = {
  all: ['requests'] as const,
  mine: ['requests', 'mine'] as const,
  detail: (id: string) => ['requests', 'detail', id] as const,
  address: (id: string) => ['requests', 'address', id] as const,
  // Seller side (spec 10).
  inboxAll: ['requests', 'inbox'] as const,
  inbox: (filter: 'waiting' | 'all') => ['requests', 'inbox', filter] as const,
  businessDetail: (id: string) => ['requests', 'businessDetail', id] as const,
  waitingCount: ['requests', 'waitingCount'] as const,
};

/** A pending request on screen is re-read this often, so an answer or an expiry shows up. */
export const PENDING_POLL_MS = 30_000;
