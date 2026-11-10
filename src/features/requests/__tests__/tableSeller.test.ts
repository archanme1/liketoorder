import { supabase } from '@/lib/supabase';

import { markRequestOutcome, respondToRequest } from '../api';
import {
  businessRequestSchema,
  sellerRequestListSchema,
  sellerTableRequestSchema,
} from '../schema';

import { makeSellerRequest } from '../__fixtures__/sellerRequests';
import { makeSellerTableRequest } from '../__fixtures__/tableRequests';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));

const db = supabase as unknown as { rpc: jest.Mock };
const ID = '44444444-4444-4444-8444-444444444444';

beforeEach(() => db.rpc.mockReset());

describe('the restaurant owner table request (strict, 17 keys)', () => {
  it('accepts the 17 keys', () => {
    const request = makeSellerTableRequest();
    expect(Object.keys(request)).toHaveLength(17);
    expect(sellerTableRequestSchema.safeParse(request).success).toBe(true);
  });

  it.each([
    ['place_id', { place_id: 'abc' }],
    ['the customer id', { customer_id: 'u1' }],
    ['an email', { customer_email: 'a@b.c' }],
  ])('refuses a request that carries %s', (_label, extra) => {
    expect(
      sellerTableRequestSchema.safeParse({ ...makeSellerTableRequest(), ...extra }).success,
    ).toBe(false);
  });

  it('a list mixes both kinds, told apart by kind', () => {
    const parsed = sellerRequestListSchema.safeParse({
      server_now: '2026-11-08T17:00:00Z',
      requests: [makeSellerRequest(), makeSellerTableRequest()],
      next_cursor: null,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.requests.map((request) => request.kind)).toEqual(['pickup', 'table']);
  });

  it('a row whose fields do not match its kind is refused', () => {
    expect(
      businessRequestSchema.safeParse({ ...makeSellerTableRequest(), kind: 'pickup' }).success,
    ).toBe(false);
  });
});

describe('respond and outcome carry the kind', () => {
  it('a table answer sends p_kind, the reason and the words', async () => {
    db.rpc.mockResolvedValue({
      data: makeSellerTableRequest({ status: 'declined', display_status: 'declined' }),
      error: null,
    });
    await respondToRequest(
      ID,
      'declined',
      { declineReason: 'other', note: 'Private party' },
      'table',
    );
    expect(db.rpc).toHaveBeenCalledWith('respond_to_request', {
      p_request_id: ID,
      p_decision: 'declined',
      p_decline_reason: 'other',
      p_note: 'Private party',
      p_kind: 'table',
    });
  });

  it('a pickup answer is exactly the call it was before spec 11: no p_kind', async () => {
    db.rpc.mockResolvedValue({ data: makeSellerRequest(), error: null });
    await respondToRequest(ID, 'accepted');
    expect(db.rpc).toHaveBeenCalledWith('respond_to_request', {
      p_request_id: ID,
      p_decision: 'accepted',
    });
  });

  it('a table outcome sends p_kind; a pickup outcome does not', async () => {
    db.rpc.mockResolvedValue({
      data: makeSellerTableRequest({ status: 'completed', display_status: 'completed' }),
      error: null,
    });
    await markRequestOutcome(ID, 'completed', 'table');
    expect(db.rpc).toHaveBeenLastCalledWith('mark_request_outcome', {
      p_request_id: ID,
      p_outcome: 'completed',
      p_kind: 'table',
    });
    db.rpc.mockResolvedValue({ data: makeSellerRequest(), error: null });
    await markRequestOutcome(ID, 'no_show');
    expect(db.rpc).toHaveBeenLastCalledWith('mark_request_outcome', {
      p_request_id: ID,
      p_outcome: 'no_show',
    });
  });

  it('the answer is read as either kind', async () => {
    db.rpc.mockResolvedValue({ data: makeSellerTableRequest(), error: null });
    await expect(respondToRequest(ID, 'accepted', {}, 'table')).resolves.toMatchObject({
      kind: 'table',
    });
  });
});
