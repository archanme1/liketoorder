import type { PickupRequest } from '../schema';

export const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
export const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

export function makeRequest(over: Partial<PickupRequest> = {}): PickupRequest {
  return {
    id: REQUEST_ID,
    business_id: BUSINESS_ID,
    business_name: "Joe's Pizza",
    business_type: 'restaurant',
    status: 'pending',
    display_status: 'pending',
    pickup_at: '2026-11-08T18:00:00+00:00',
    items: [{ item_id: 'i1', name: 'Margherita', unit_price_minor: 1250, quantity: 2 }],
    order_text: null,
    note: null,
    currency_code: 'CAD',
    expires_at: '2026-11-08T17:30:00+00:00',
    created_at: '2026-11-08T17:00:00+00:00',
    ...over,
  };
}
