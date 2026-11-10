import type { TableRequest } from '../schema';

import { BUSINESS_ID } from './requests';

export const TABLE_REQUEST_ID = '44444444-4444-4444-8444-444444444444';

/** A customer's table request as the server writes it: the table is at 7:00 pm in Toronto in November (EST). */
export function makeTableRequest(over: Partial<TableRequest> = {}): TableRequest {
  return {
    id: TABLE_REQUEST_ID,
    kind: 'table',
    business_id: BUSINESS_ID,
    business_name: "Luigi's",
    business_type: 'restaurant',
    status: 'pending',
    display_status: 'pending',
    table_at: '2026-11-09T00:00:00+00:00',
    party_size: 4,
    note: null,
    expires_at: '2026-11-09T00:00:00+00:00',
    created_at: '2026-11-08T17:00:00+00:00',
    decline_reason: null,
    response_note: null,
    arrived_at: null,
    ...over,
  };
}
