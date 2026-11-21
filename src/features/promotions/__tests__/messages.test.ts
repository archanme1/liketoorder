import type { PromotionErrorCode } from '../api';
import { CATEGORY_LABELS, promotionErrorMessage, REJECT_REASON_TEXT } from '../messages';

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

  it('says promotions are not available yet when there is no price', () => {
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
});
