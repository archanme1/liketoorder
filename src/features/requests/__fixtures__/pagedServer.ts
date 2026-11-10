import { PAGE_SIZE, type CustomerRequest, type PickupRequest, type RequestList } from '../schema';

import { makeRequest } from './requests';
import { makeTableRequest } from './tableRequests';

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

const zulu = (createdAt: string) => createdAt.replace('+00:00', 'Z');
export const cursorOf = (row: CustomerRequest) => `${zulu(row.created_at)}|${row.id}`;

/**
 * An in-memory list_my_requests: the server order (created_at desc, id desc), a keyset cursor
 * "<created_at>|<id>" (rows strictly after it), 50 a page, next_cursor null on the last page.
 * `rows` can be changed between calls to play a request being added, removed or updated.
 */
export function pagedServer(state: { rows: CustomerRequest[] }) {
  return async (before?: string): Promise<RequestList> => {
    const matching = [...state.rows]
      .sort((a, b) => {
        const x = cursorOf(a);
        const y = cursorOf(b);
        return x < y ? 1 : x > y ? -1 : 0;
      })
      .filter((row) => before === undefined || cursorOf(row) < before);
    const requests = matching.slice(0, PAGE_SIZE);
    return {
      server_now: '2026-11-08T17:00:00Z',
      requests,
      next_cursor: matching.length > PAGE_SIZE ? cursorOf(requests[requests.length - 1]) : null,
    };
  };
}

/**
 * Like makeRows, but every third row is a table request (same ids, same minute spacing and
 * microsecond created_at), so a list holds both kinds in one keyset order.
 */
export function makeMixedRows(count: number): CustomerRequest[] {
  return makeRows(count).map((row, i) =>
    i % 3 === 2
      ? makeTableRequest({
          id: row.id,
          business_name: row.business_name,
          created_at: row.created_at,
          status: row.status,
          display_status: row.display_status,
        })
      : row,
  );
}
