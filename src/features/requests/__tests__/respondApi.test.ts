import { supabase } from '@/lib/supabase';

import { respondToRequest } from '../api';

import { REQUEST_ID } from '../__fixtures__/requests';
import { makeSellerRequest } from '../__fixtures__/sellerRequests';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));

const db = supabase as unknown as { rpc: jest.Mock };

beforeEach(() => {
  db.rpc.mockReset();
  db.rpc.mockResolvedValue({ data: makeSellerRequest(), error: null });
});

describe('respondToRequest arguments (spec 10b)', () => {
  it('sends only the id and the decision for a plain accept', async () => {
    await respondToRequest(REQUEST_ID, 'accepted');
    expect(db.rpc).toHaveBeenCalledWith('respond_to_request', {
      p_request_id: REQUEST_ID,
      p_decision: 'accepted',
    });
  });

  it('sends the accept note', async () => {
    await respondToRequest(REQUEST_ID, 'accepted', { note: 'Please bring a bag' });
    expect(db.rpc).toHaveBeenCalledWith('respond_to_request', {
      p_request_id: REQUEST_ID,
      p_decision: 'accepted',
      p_note: 'Please bring a bag',
    });
  });

  it('sends the code alone for a fixed decline reason', async () => {
    await respondToRequest(REQUEST_ID, 'declined', { declineReason: 'sold_out' });
    expect(db.rpc).toHaveBeenCalledWith('respond_to_request', {
      p_request_id: REQUEST_ID,
      p_decision: 'declined',
      p_decline_reason: 'sold_out',
    });
    const args = db.rpc.mock.calls[0][1];
    expect(args).not.toHaveProperty('p_note');
  });

  it('sends the seller words as the note for Other', async () => {
    await respondToRequest(REQUEST_ID, 'declined', { declineReason: 'other', note: 'Oven broke' });
    expect(db.rpc).toHaveBeenCalledWith('respond_to_request', {
      p_request_id: REQUEST_ID,
      p_decision: 'declined',
      p_decline_reason: 'other',
      p_note: 'Oven broke',
    });
  });
});

describe('respondToRequest errors', () => {
  it.each(['decline_reason_required', 'invalid_text', 'invalid_input', 'invalid_transition', 'not_found'])(
    'maps %s to a coded error',
    async (message) => {
      db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } });
      await expect(respondToRequest(REQUEST_ID, 'declined')).rejects.toMatchObject({
        code: message,
      });
    },
  );

  it('reads the answer keys back from the server', async () => {
    db.rpc.mockResolvedValue({
      data: makeSellerRequest({
        status: 'declined',
        display_status: 'declined',
        decline_reason: 'other',
        response_note: 'Oven broke',
      }),
      error: null,
    });
    const request = await respondToRequest(REQUEST_ID, 'declined', {
      declineReason: 'other',
      note: 'Oven broke',
    });
    expect(request.decline_reason).toBe('other');
    expect(request.response_note).toBe('Oven broke');
  });

  it('refuses an answer without the new keys', async () => {
    const { decline_reason: _reason, ...old } = makeSellerRequest();
    db.rpc.mockResolvedValue({ data: old, error: null });
    await expect(respondToRequest(REQUEST_ID, 'accepted')).rejects.toMatchObject({
      code: 'unknown',
    });
  });
});
