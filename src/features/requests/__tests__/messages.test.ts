import type { RequestErrorCode } from '../api';
import * as messages from '../messages';

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

describe('messages', () => {
  it('has wording for every error code', () => {
    for (const code of CODES) expect(messages.requestErrorMessage(code).length).toBeGreaterThan(0);
  });

  it('uses one kind of apostrophe (the straight one) everywhere', () => {
    const all = [
      ...CODES.map((code) => messages.requestErrorMessage(code)),
      ...CODES.map((code) => messages.loadErrorMessage(code)),
      messages.PAY_NOTE,
      messages.NO_PRICE_NOTE,
      messages.NO_MENU_NOTE,
      messages.EMPTY_LIST,
      messages.NOT_AVAILABLE,
      messages.sentMessage("Joe's"),
    ];
    for (const text of all) expect(text).not.toMatch(/[‘’]/);
  });

  it('keeps the exact wording the server errors map to', () => {
    expect(messages.requestErrorMessage('invalid_pickup_time')).toBe('Pick a later time');
    expect(messages.requestErrorMessage('empty_order')).toBe(
      "Choose an item or describe what you'd like.",
    );
  });

  it('no longer exports the unused SENT_TITLE', () => {
    expect('SENT_TITLE' in messages).toBe(false);
  });
});
