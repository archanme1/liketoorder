import { PAGE_SIZE, type PickupRequest } from '../schema';

import { makeRequest } from './requests';

const BASE = Date.parse('2026-11-08T17:00:00.000Z');

/**
 * `count` requests, newest first, one minute apart. created_at carries microseconds
 * ("…:00.123456+00:00") so a cursor that was parsed into a Date and printed back would not match.
 */
export function makeRows(
  count: number,
  status: PickupRequest['status'] = 'declined',
): PickupRequest[] {
  return Array.from({ length: count }, (_, i) =>
    makeRequest({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      business_name: `Place ${i + 1}`,
      status,
      display_status: status,
      created_at: new Date(BASE - i * 60_000).toISOString().replace('.000Z', '.123456+00:00'),
    }),
  );
}

/**
 * An in-memory list_my_pickup_requests: rows strictly older than `before`, newest first, one page
 * of 50. `rows` can be changed between calls to play a request being added, removed or updated.
 */
export function pagedServer(state: { rows: PickupRequest[] }) {
  return async (before?: string) => ({
    server_now: '2026-11-08T17:00:00Z',
    requests: [...state.rows]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      .filter((row) => before === undefined || row.created_at < before)
      .slice(0, PAGE_SIZE),
  });
}
