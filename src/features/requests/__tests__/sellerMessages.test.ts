import type { RequestErrorCode } from '../api';
import { REQUEST_STATUSES } from '../schema';
import {
  actionErrorMessage,
  customerLabel,
  emptyMessage,
  inboxErrorMessage,
  sellerStatusSentence,
  ACCEPT_ADDRESS_NOTICE,
} from '../sellerMessages';

const CODES: RequestErrorCode[] = [
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
  'invalid_transition',
  'not_found',
  'network',
  'unknown',
];

describe('sellerStatusSentence', () => {
  it('has a sentence for every status', () => {
    for (const status of REQUEST_STATUSES) expect(sellerStatusSentence(status, 'pickup')).toBeTruthy();
  });

  it.each(['pending', 'declined', 'expired', 'cancelled'] as const)(
    'never reads %s as accepted, confirmed or booked',
    (status) => {
      expect(sellerStatusSentence(status, 'pickup')).not.toMatch(/accepted|confirm|book/i);
    },
  );

  it('pending is waiting for the seller, not for the customer', () => {
    expect(sellerStatusSentence('pending', 'pickup')).toBe('Waiting for your answer');
  });
});

describe('error messages', () => {
  it.each(CODES)('says something plain for %s, never the raw code', (code) => {
    for (const text of [actionErrorMessage(code), inboxErrorMessage(code)]) {
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain('_');
    }
  });

  it('explains a changed request calmly and points to the shown status', () => {
    expect(actionErrorMessage('invalid_transition')).toMatch(/current status is shown/i);
  });

  it('says nothing was changed when there is no connection', () => {
    expect(actionErrorMessage('network')).toMatch(/nothing was changed/i);
  });
});

describe('small helpers', () => {
  it('names the customer, with a fallback', () => {
    expect(customerLabel('Sam')).toBe('Sam');
    expect(customerLabel('  ')).toBe('Customer');
    expect(customerLabel(null)).toBe('Customer');
  });

  it('has the spec wording for the empty states', () => {
    expect(emptyMessage('waiting')).toBe('Nothing waiting for you right now.');
    expect(emptyMessage('all')).toBe(
      'No requests yet. Customers who request pickup will show up here.',
    );
  });

  it('the address notice names the exact address and the 24 hours', () => {
    expect(ACCEPT_ADDRESS_NOTICE).toMatch(/exact address/);
    expect(ACCEPT_ADDRESS_NOTICE).toMatch(/24 hours/);
  });
});
