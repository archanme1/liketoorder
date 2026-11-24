import type { PromotionErrorCode } from '../api';
import {
  CATEGORY_LABELS,
  CONTACT_TO_CANCEL_TEXT,
  PAID_SCHEDULED_PREFIX,
  promotionErrorMessage,
  REJECT_REASON_TEXT,
  REQUESTED_TEXT,
  REVIEW_NOTE,
  SCHEDULED_PREFIX,
  START_NOTE,
} from '../messages';

const CODES: PromotionErrorCode[] = [
  'not_authenticated',
  'not_eligible',
  'not_configured',
  'already_open',
  'too_many_requests',
  'invalid_headline',
  'invalid_category',
  'invalid_start',
  'not_found',
  'not_cancellable',
  'contact_support',
  'network',
  'unknown',
];

describe('promotion messages', () => {
  it('has a different plain message for every code', () => {
    const messages = CODES.map(promotionErrorMessage);
    for (const message of messages) expect(message.length).toBeGreaterThan(10);
    expect(new Set(messages).size).toBe(CODES.length);
  });

  it('never shows a code word to the seller', () => {
    for (const code of CODES) expect(promotionErrorMessage(code)).not.toMatch(/_/);
  });

  it('words the seller status lines and notes of spec 16b PR 3 exactly (no price, no payment)', () => {
    expect(REQUESTED_TEXT).toBe('Waiting for review.');
    expect(START_NOTE).toBe("We'll confirm the exact dates when your promotion is scheduled.");
    expect(REVIEW_NOTE).toBe('We review every headline before it goes live.');
    expect(PAID_SCHEDULED_PREFIX).toBe('Paid and scheduled.');
    expect(SCHEDULED_PREFIX).toBe('Scheduled.');
    expect(CONTACT_TO_CANCEL_TEXT).toBe('Contact us to cancel.');
  });

  it('says promotions are not available yet when there is no settings row', () => {
    expect(promotionErrorMessage('not_configured')).toBe("Promotions aren't available yet.");
  });

  it('labels the three categories in plain words', () => {
    expect(CATEGORY_LABELS).toEqual({
      new_dish: 'New on the menu',
      special_offer: 'Special offer',
      featured: 'Featured',
    });
  });

  it('has a reason text for each rejection', () => {
    expect(Object.keys(REJECT_REASON_TEXT).sort()).toEqual(
      ['headline', 'not_eligible', 'not_paid', 'other'].sort(),
    );
  });

  it('reads naturally after "Not approved:" for all four reasons', () => {
    const sentences = Object.values(REJECT_REASON_TEXT).map((text) => `Not approved: ${text}`);
    expect(sentences).toEqual([
      "Not approved: the headline can't be used. You can send a new request with another one.",
      'Not approved: the payment window closed.',
      "Not approved: this business can't be promoted right now.",
      "Not approved: the request couldn't be accepted.",
    ]);
  });
});
