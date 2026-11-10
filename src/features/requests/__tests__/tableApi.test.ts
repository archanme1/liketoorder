import { supabase } from '@/lib/supabase';

import {
  cancelTableRequest,
  getMyTableRequest,
  mapRequestError,
  markArrived,
  submitTableRequest,
} from '../api';

import { BUSINESS_ID } from '../__fixtures__/requests';
import { makeTableRequest, TABLE_REQUEST_ID } from '../__fixtures__/tableRequests';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));

const db = supabase as unknown as { rpc: jest.Mock };
const KEY = '33333333-3333-4333-8333-333333333333';

beforeEach(() => db.rpc.mockReset());

describe('submitTableRequest', () => {
  it('sends the business, key, UTC time, party and note, and nothing else', async () => {
    db.rpc.mockResolvedValue({ data: makeTableRequest(), error: null });
    await submitTableRequest({
      businessId: BUSINESS_ID,
      idempotencyKey: KEY,
      tableAt: new Date('2026-11-09T00:00:00Z'),
      partySize: 4,
      note: 'window',
    });
    expect(db.rpc).toHaveBeenCalledWith('submit_table_request', {
      p_business_id: BUSINESS_ID,
      p_idempotency_key: KEY,
      p_table_at: '2026-11-09T00:00:00.000Z',
      p_party_size: 4,
      p_note: 'window',
    });
  });

  it('refuses an answer that is not a table request', async () => {
    db.rpc.mockResolvedValue({ data: { ...makeTableRequest(), place_id: 'x' }, error: null });
    await expect(
      submitTableRequest({
        businessId: BUSINESS_ID,
        idempotencyKey: KEY,
        tableAt: new Date('2026-11-09T00:00:00Z'),
        partySize: 4,
      }),
    ).rejects.toMatchObject({ code: 'unknown' });
  });

  it.each([
    'invalid_table_time',
    'invalid_party_size',
    'business_unavailable',
    'own_business',
    'too_many_pending',
    'rate_limited',
    'invalid_text',
  ])('maps %s', async (message) => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } });
    await expect(
      submitTableRequest({
        businessId: BUSINESS_ID,
        idempotencyKey: KEY,
        tableAt: new Date('2026-11-09T00:00:00Z'),
        partySize: 4,
      }),
    ).rejects.toMatchObject({ code: message });
  });
});

describe('the other table calls', () => {
  it('cancels and reads by request id only', async () => {
    db.rpc.mockResolvedValue({
      data: makeTableRequest({ status: 'cancelled', display_status: 'cancelled' }),
      error: null,
    });
    await expect(cancelTableRequest(TABLE_REQUEST_ID)).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(db.rpc).toHaveBeenLastCalledWith('cancel_table_request', {
      p_request_id: TABLE_REQUEST_ID,
    });

    db.rpc.mockResolvedValue({
      data: { server_now: '2026-11-08T17:00:00Z', request: null },
      error: null,
    });
    await expect(getMyTableRequest(TABLE_REQUEST_ID)).resolves.toMatchObject({ request: null });
    expect(db.rpc).toHaveBeenLastCalledWith('get_my_table_request', {
      p_request_id: TABLE_REQUEST_ID,
    });
  });

  it('marks arrived with the request id alone: no location, no client time', async () => {
    db.rpc.mockResolvedValue({
      data: makeTableRequest({
        status: 'accepted',
        display_status: 'accepted',
        arrived_at: '2026-11-08T23:30:00+00:00',
      }),
      error: null,
    });
    await markArrived(TABLE_REQUEST_ID);
    expect(db.rpc).toHaveBeenCalledWith('mark_arrived', { p_request_id: TABLE_REQUEST_ID });
  });

  it.each(['already_arrived', 'arrival_window', 'invalid_transition', 'not_found'])(
    'maps %s from mark_arrived',
    async (message) => {
      db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } });
      await expect(markArrived(TABLE_REQUEST_ID)).rejects.toMatchObject({ code: message });
    },
  );
});

describe('mapRequestError', () => {
  it('keeps an unknown message as unknown', () => {
    expect(mapRequestError({ code: 'P0001', message: 'something_else' }).code).toBe('unknown');
  });
});
