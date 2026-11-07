import { supabase } from '@/lib/supabase';

import {
  cancelPickupRequest,
  getMyPickupAddress,
  getPickupRequest,
  listMyPickupRequests,
  mapRequestError,
  submitPickupRequest,
} from '../api';

import { BUSINESS_ID, makeRequest, REQUEST_ID } from '../__fixtures__/requests';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));

const db = supabase as unknown as { rpc: jest.Mock; from: jest.Mock };
const KEY = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  db.rpc.mockReset();
  db.from.mockReset();
});

describe('submitPickupRequest', () => {
  it('sends ids and quantities only, never a name, price or status', async () => {
    db.rpc.mockResolvedValue({ data: makeRequest(), error: null });
    await submitPickupRequest({
      businessId: BUSINESS_ID,
      idempotencyKey: KEY,
      pickupAt: new Date('2026-11-08T18:00:00Z'),
      items: [{ itemId: 'i1', quantity: 2 }],
      orderText: 'no onions',
      note: undefined,
    });
    expect(db.rpc).toHaveBeenCalledWith('submit_pickup_request', {
      p_business_id: BUSINESS_ID,
      p_idempotency_key: KEY,
      p_pickup_at: '2026-11-08T18:00:00.000Z',
      p_items: [{ item_id: 'i1', quantity: 2 }],
      p_order_text: 'no onions',
      p_note: undefined,
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('returns the parsed request', async () => {
    db.rpc.mockResolvedValue({ data: makeRequest(), error: null });
    await expect(
      submitPickupRequest({
        businessId: BUSINESS_ID,
        idempotencyKey: KEY,
        pickupAt: new Date(),
        orderText: 'x',
      }),
    ).resolves.toEqual(makeRequest());
  });

  it('refuses a payload with extra fields', async () => {
    db.rpc.mockResolvedValue({ data: { ...makeRequest(), place_id: 'p' }, error: null });
    await expect(
      submitPickupRequest({
        businessId: BUSINESS_ID,
        idempotencyKey: KEY,
        pickupAt: new Date(),
        orderText: 'x',
      }),
    ).rejects.toMatchObject({ code: 'unknown' });
  });

  it.each([
    'not_signed_in',
    'profile_incomplete',
    'invalid_input',
    'business_unavailable',
    'own_business',
    'invalid_pickup_time',
    'invalid_items',
    'invalid_text',
    'item_unavailable',
    'empty_order',
    'too_many_pending',
    'rate_limited',
  ])('maps %s to a coded error', async (message) => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } });
    await expect(
      submitPickupRequest({
        businessId: BUSINESS_ID,
        idempotencyKey: KEY,
        pickupAt: new Date(),
        orderText: 'x',
      }),
    ).rejects.toMatchObject({ code: message });
  });
});

describe('cancelPickupRequest', () => {
  it('calls cancel_pickup_request with the id', async () => {
    db.rpc.mockResolvedValue({
      data: makeRequest({ status: 'cancelled', display_status: 'cancelled' }),
      error: null,
    });
    const result = await cancelPickupRequest(REQUEST_ID);
    expect(db.rpc).toHaveBeenCalledWith('cancel_pickup_request', { p_request_id: REQUEST_ID });
    expect(result.status).toBe('cancelled');
  });

  it.each(['invalid_transition', 'not_found'])('maps %s', async (message) => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } });
    await expect(cancelPickupRequest(REQUEST_ID)).rejects.toMatchObject({ code: message });
  });
});

describe('reads', () => {
  it('lists with an optional cursor', async () => {
    const data = { server_now: '2026-11-08T17:00:00Z', requests: [makeRequest()] };
    db.rpc.mockResolvedValue({ data, error: null });
    await expect(listMyPickupRequests()).resolves.toEqual(data);
    expect(db.rpc).toHaveBeenLastCalledWith('list_my_pickup_requests', { p_before: undefined });
    await listMyPickupRequests('2026-11-08T17:00:00Z');
    expect(db.rpc).toHaveBeenLastCalledWith('list_my_pickup_requests', {
      p_before: '2026-11-08T17:00:00Z',
    });
  });

  it('gets one request, or null for not found', async () => {
    db.rpc.mockResolvedValue({
      data: { server_now: '2026-11-08T17:00:00Z', request: null },
      error: null,
    });
    const result = await getPickupRequest(REQUEST_ID);
    expect(result.request).toBeNull();
    expect(db.rpc).toHaveBeenCalledWith('get_my_pickup_request', { p_request_id: REQUEST_ID });
  });

  it('address: object, null, or refuses extras', async () => {
    db.rpc.mockResolvedValue({ data: { formatted_address: '1 King St' }, error: null });
    await expect(getMyPickupAddress(REQUEST_ID)).resolves.toEqual({
      formatted_address: '1 King St',
    });
    db.rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMyPickupAddress(REQUEST_ID)).resolves.toBeNull();
    db.rpc.mockResolvedValue({
      data: { formatted_address: '1 King St', place_id: 'p' },
      error: null,
    });
    await expect(getMyPickupAddress(REQUEST_ID)).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('mapRequestError', () => {
  it('maps network failures, unknown codes and non-errors', () => {
    expect(mapRequestError({ message: 'Network request failed' }).code).toBe('network');
    expect(mapRequestError({ code: 'P0001', message: 'something_else' }).code).toBe('unknown');
    expect(mapRequestError({ code: '42501', message: 'permission denied' }).code).toBe('unknown');
    expect(mapRequestError(null).code).toBe('unknown');
  });

  it('never carries the upstream message', () => {
    const error = mapRequestError({ code: 'P0001', message: 'own_business', details: 'secret' });
    expect(error.message).toBe('own_business');
    expect(JSON.stringify(error)).not.toMatch(/secret/);
  });
});
