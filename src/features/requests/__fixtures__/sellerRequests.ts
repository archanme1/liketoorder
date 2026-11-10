import {
  PAGE_SIZE,
  type BusinessRequest,
  type InboxFilter,
  type SellerRequest,
  type SellerRequestList,
} from '../schema';

import { makeRequest } from './requests';
import { makeSellerTableRequest } from './tableRequests';

const BASE = Date.parse('2026-11-08T17:00:00.000Z');

export function makeSellerRequest(over: Partial<SellerRequest> = {}): SellerRequest {
  return {
    ...makeRequest(),
    customer_name: 'Sam Rivera',
    responded_at: null,
    ...over,
  };
}

/**
 * `count` seller requests with ids ascending (…0001, …0002). Normally one minute apart, newest
 * first by index; with `sharedCreatedAt` every row has that one created_at (a keyset tie).
 * created_at carries microseconds, as the server writes it.
 */
export function makeSellerRows(
  count: number,
  options: { status?: SellerRequest['status']; sharedCreatedAt?: string } = {},
): SellerRequest[] {
  const status = options.status ?? 'pending';
  return Array.from({ length: count }, (_, i) =>
    makeSellerRequest({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      customer_name: `Customer ${i + 1}`,
      status,
      display_status: status,
      created_at:
        options.sharedCreatedAt ??
        new Date(BASE - i * 60_000).toISOString().replace('.000Z', '.123456+00:00'),
    }),
  );
}

const zulu = (createdAt: string) => createdAt.replace('+00:00', 'Z');
const cursorOf = (row: BusinessRequest) => `${zulu(row.created_at)}|${row.id}`;

/** The server's order: (created_at desc, id desc). */
export function sortSellerRows<T extends BusinessRequest>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const x = cursorOf(a);
    const y = cursorOf(b);
    return x < y ? 1 : x > y ? -1 : 0;
  });
}

/**
 * An in-memory list_business_requests: the filter, the server order, a keyset cursor
 * "<created_at>|<id>" (rows strictly after it), 50 a page, next_cursor null on the last page.
 * `rows` can be changed between calls to play requests being added, answered or removed.
 */
export function sellerPagedServer(state: { rows: BusinessRequest[] }) {
  return async (filter: InboxFilter, before?: string): Promise<SellerRequestList> => {
    const matching = sortSellerRows(state.rows)
      .filter((row) => filter === 'all' || row.display_status === 'pending')
      .filter((row) => before === undefined || cursorOf(row) < before);
    const page = matching.slice(0, PAGE_SIZE);
    return {
      server_now: '2026-11-08T17:00:00Z',
      requests: page,
      next_cursor: matching.length > PAGE_SIZE ? cursorOf(page[page.length - 1]) : null,
    };
  };
}

/** Like makeSellerRows, but every third row is a table request, so one inbox holds both kinds. */
export function makeMixedSellerRows(count: number): BusinessRequest[] {
  return makeSellerRows(count).map((row, i) =>
    i % 3 === 2
      ? makeSellerTableRequest({
          id: row.id,
          customer_name: row.customer_name,
          created_at: row.created_at,
          status: row.status,
          display_status: row.display_status,
        })
      : row,
  );
}
