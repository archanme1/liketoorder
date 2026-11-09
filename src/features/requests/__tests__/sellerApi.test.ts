import { supabase } from '@/lib/supabase';

import {
  countWaitingRequests,
  getBusinessRequest,
  listBusinessRequests,
  markRequestOutcome,
  respondToRequest,
} from '../api';

import { REQUEST_ID } from '../__fixtures__/requests';
import { makeSellerRequest } from '../__fixtures__/sellerRequests';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));

const db = supabase as unknown as { rpc: jest.Mock; from: jest.Mock };
const NOW = '2026-11-08T17:00:00Z';
const CURSOR = '2026-11-08T16:59:00.123456Z|00000000-0000-4000-8000-000000000050';

beforeEach(() => {
  db.rpc.mockReset();
  db.from.mockReset();
});

describe('listBusinessRequests', () => {
  it('asks for the waiting filter and passes the cursor back untouched', async () => {
    db.rpc.mockResolvedValue({
      data: { server_now: NOW, requests: [makeSellerRequest()], next_cursor: CURSOR },
      error: null,
    });
    const page = await listBusinessRequests('waiting', CURSOR);
    expect(db.rpc).toHaveBeenCalledWith('list_business_requests', {
      p_status: 'waiting',
      p_before: CURSOR,
    });
    expect(page.next_cursor).toBe(CURSOR);
  });

  it('sends no status for All', async () => {
    db.rpc.mockResolvedValue({
      data: { server_now: NOW, requests: [], next_cursor: null },
      error: null,
    });
    await listBusinessRequests('all');
    expect(db.rpc).toHaveBeenCalledWith('list_business_requests', {
      p_status: undefined,
      p_before: undefined,
    });
  });

  it('maps a server error to a coded error', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_input' } });
    await expect(listBusinessRequests('all')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses a payload that does not match the contract', async () => {
    db.rpc.mockResolvedValue({
      data: { server_now: NOW, requests: [{ ...makeSellerRequest(), accepted_address: 'x' }] },
      error: null,
    });
    await expect(listBusinessRequests('all')).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('getBusinessRequest', () => {
  it('reads one request by id and allows null (unknown or not theirs)', async () => {
    db.rpc.mockResolvedValue({ data: { server_now: NOW, request: null }, error: null });
    const detail = await getBusinessRequest(REQUEST_ID);
    expect(db.rpc).toHaveBeenCalledWith('get_business_request', { p_request_id: REQUEST_ID });
    expect(detail.request).toBeNull();
  });
});

describe('respondToRequest / markRequestOutcome', () => {
  it('sends only the id and the decision', async () => {
    db.rpc.mockResolvedValue({ data: makeSellerRequest({ status: 'accepted' }), error: null });
    const request = await respondToRequest(REQUEST_ID, 'accepted');
    expect(db.rpc).toHaveBeenCalledWith('respond_to_request', {
      p_request_id: REQUEST_ID,
      p_decision: 'accepted',
    });
    expect(request.status).toBe('accepted');
  });

  it('sends only the id and the outcome', async () => {
    db.rpc.mockResolvedValue({ data: makeSellerRequest({ status: 'no_show' }), error: null });
    await markRequestOutcome(REQUEST_ID, 'no_show');
    expect(db.rpc).toHaveBeenCalledWith('mark_request_outcome', {
      p_request_id: REQUEST_ID,
      p_outcome: 'no_show',
    });
  });

  it.each(['invalid_transition', 'not_found'] as const)('maps %s', async (message) => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } });
    await expect(respondToRequest(REQUEST_ID, 'declined')).rejects.toMatchObject({ code: message });
    await expect(markRequestOutcome(REQUEST_ID, 'completed')).rejects.toMatchObject({
      code: message,
    });
  });

  it('maps a lost connection to network, without carrying the upstream message', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Network request failed' } });
    const error = await respondToRequest(REQUEST_ID, 'accepted').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'network', message: 'network' });
  });

  it('refuses an answer that is not a seller request', async () => {
    db.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(respondToRequest(REQUEST_ID, 'accepted')).rejects.toMatchObject({
      code: 'unknown',
    });
  });
});

describe('countWaitingRequests', () => {
  it('reads the count', async () => {
    db.rpc.mockResolvedValue({ data: { server_now: NOW, waiting: 4 }, error: null });
    await expect(countWaitingRequests()).resolves.toEqual({ server_now: NOW, waiting: 4 });
    expect(db.rpc).toHaveBeenCalledWith('count_waiting_requests');
  });
});
