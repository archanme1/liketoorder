import {
  sellerRequestDetailSchema,
  sellerRequestListSchema,
  sellerRequestSchema,
  waitingCountSchema,
} from '../schema';

import { makeSellerRequest } from '../__fixtures__/sellerRequests';

const NOW = '2026-11-08T17:00:00Z';

describe('seller response schemas (strict)', () => {
  it('accepts the server shape', () => {
    expect(sellerRequestSchema.safeParse(makeSellerRequest()).success).toBe(true);
    expect(
      sellerRequestListSchema.safeParse({
        server_now: NOW,
        requests: [makeSellerRequest()],
        next_cursor: null,
      }).success,
    ).toBe(true);
    expect(sellerRequestDetailSchema.safeParse({ server_now: NOW, request: null }).success).toBe(
      true,
    );
    expect(waitingCountSchema.safeParse({ server_now: NOW, waiting: 3 }).success).toBe(true);
  });

  it('accepts a request whose customer has no name and one not answered yet', () => {
    expect(
      sellerRequestSchema.safeParse(makeSellerRequest({ customer_name: null, responded_at: null }))
        .success,
    ).toBe(true);
  });

  it.each([
    ['the exact address snapshot', { accepted_address: '1 King St' }],
    ["the customer's id", { customer_id: 'u1' }],
    ["the customer's email", { customer_email: 'a@b.c' }],
    ['place_id', { place_id: 'abc' }],
    ['map coordinates', { map_lat: 1, map_lng: 2 }],
  ])('refuses a request that carries %s', (_label, extra) => {
    expect(sellerRequestSchema.safeParse({ ...makeSellerRequest(), ...extra }).success).toBe(false);
  });

  it('refuses a customer-shaped request (no customer_name)', () => {
    const { customer_name: _name, ...rest } = makeSellerRequest();
    expect(sellerRequestSchema.safeParse(rest).success).toBe(false);
  });

  it('keeps the cursor as the exact string the server wrote', () => {
    const cursor = '2026-11-08T16:59:00.123456Z|00000000-0000-4000-8000-000000000050';
    const parsed = sellerRequestListSchema.parse({
      server_now: NOW,
      requests: [],
      next_cursor: cursor,
    });
    expect(parsed.next_cursor).toBe(cursor);
  });

  it('refuses an empty cursor, a negative or fractional count, and extra list fields', () => {
    const base = { server_now: NOW, requests: [] };
    expect(sellerRequestListSchema.safeParse({ ...base, next_cursor: '' }).success).toBe(false);
    expect(sellerRequestListSchema.safeParse({ ...base, next_cursor: null, extra: 1 }).success).toBe(
      false,
    );
    expect(waitingCountSchema.safeParse({ server_now: NOW, waiting: -1 }).success).toBe(false);
    expect(waitingCountSchema.safeParse({ server_now: NOW, waiting: 1.5 }).success).toBe(false);
  });
});
