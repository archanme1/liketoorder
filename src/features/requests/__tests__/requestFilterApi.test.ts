import { supabase } from '@/lib/supabase';

import { listBusinessRequests, listMyRequests } from '../api';
import { FILTER_LABELS, SENT_FILTER_GROUP, sentEmptyMessage } from '../messages';
import { REQUEST_FILTERS } from '../schema';
import { RECEIVED_FILTER_GROUP, emptyMessage } from '../sellerMessages';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));

const db = supabase as unknown as { rpc: jest.Mock };
const CURSOR = '2026-11-08T16:59:00.123456Z|00000000-0000-4000-8000-000000000050';
const EMPTY = {
  data: { server_now: '2026-11-08T17:00:00Z', requests: [], next_cursor: null },
  error: null,
};

beforeEach(() => {
  db.rpc.mockReset();
  db.rpc.mockResolvedValue(EMPTY);
});

describe('the filter contract sent to the server', () => {
  it('the filters, in chip order', () => {
    expect(REQUEST_FILTERS).toEqual(['all', 'pending', 'accepted', 'declined']);
  });

  it.each([
    ['all', undefined],
    ['pending', 'pending'],
    ['accepted', 'accepted'],
    ['declined', 'declined'],
  ] as const)('Sent %s sends p_status %s with the cursor untouched', async (filter, status) => {
    await listMyRequests(CURSOR, filter);
    const [name, args] = db.rpc.mock.calls[0];
    expect(name).toBe('list_my_requests');
    expect(args).toStrictEqual({ p_before: CURSOR, p_status: status });
  });

  it('Sent with no filter sends no status (as the app on main does)', async () => {
    await listMyRequests();
    expect(db.rpc.mock.calls[0][1]).toStrictEqual({ p_before: undefined, p_status: undefined });
  });

  it.each([
    ['all', undefined],
    ['pending', 'pending'],
    ['accepted', 'accepted'],
    ['declined', 'declined'],
  ] as const)('Received %s sends p_status %s with the cursor untouched', async (filter, status) => {
    await listBusinessRequests(filter, CURSOR);
    const [name, args] = db.rpc.mock.calls[0];
    expect(name).toBe('list_business_requests');
    expect(args).toStrictEqual({ p_status: status, p_before: CURSOR });
  });

  it('never sends the old waiting value', async () => {
    for (const filter of REQUEST_FILTERS) {
      await listMyRequests(undefined, filter);
      await listBusinessRequests(filter);
    }
    for (const [, args] of db.rpc.mock.calls) expect(args.p_status).not.toBe('waiting');
  });
});

describe('the wording', () => {
  it('chip labels and group labels', () => {
    expect(FILTER_LABELS).toEqual({
      all: 'All',
      pending: 'Pending',
      accepted: 'Accepted',
      declined: 'Declined',
    });
    expect(SENT_FILTER_GROUP).toBe('Filter sent requests');
    expect(RECEIVED_FILTER_GROUP).toBe('Filter received requests');
  });

  it('Sent empty texts', () => {
    expect(sentEmptyMessage('all')).toBe('No requests yet. Requests you send will show up here.');
    expect(sentEmptyMessage('pending')).toBe('Nothing waiting for an answer right now.');
    expect(sentEmptyMessage('accepted')).toBe('No accepted requests yet.');
    expect(sentEmptyMessage('declined')).toBe('No declined requests.');
  });

  it('Received empty texts', () => {
    expect(emptyMessage('all')).toBe(
      'No requests yet. Customers who send you requests will show up here.',
    );
    expect(emptyMessage('pending')).toBe('Nothing waiting for you right now.');
    expect(emptyMessage('accepted')).toBe('No accepted requests yet.');
    expect(emptyMessage('declined')).toBe('No declined requests.');
  });

  it('no text uses a curly apostrophe or a hidden character', () => {
    const texts = [
      ...Object.values(FILTER_LABELS),
      SENT_FILTER_GROUP,
      RECEIVED_FILTER_GROUP,
      ...REQUEST_FILTERS.map(sentEmptyMessage),
      ...REQUEST_FILTERS.map(emptyMessage),
    ];
    for (const text of texts) expect(text).toMatch(/^[\x20-\x7E]+$/);
  });
});
