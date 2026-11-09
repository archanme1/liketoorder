import {
  DECLINE_REASON_ORDER,
  declineReasonLabel,
  declineReasonText,
} from '../declineReasons';
import { declinedLine, sellerNoteLine } from '../messages';
import {
  ACCEPT_ADDRESS_HINT,
  actionErrorMessage,
  counterText,
} from '../sellerMessages';

describe('declineReasons', () => {
  it('lists the six reasons in the picker order with Other last', () => {
    expect(DECLINE_REASON_ORDER.map(declineReasonText)).toEqual([
      'Sold out',
      'Closed at that time',
      'Too busy right now',
      "Can't prepare this order",
      "Pickup time doesn't work",
      'Other',
    ]);
  });

  it('labels a fixed reason by its words and Other by the seller words', () => {
    expect(declineReasonLabel('too_busy', null)).toBe('Too busy right now');
    expect(declineReasonLabel('other', 'Oven broke')).toBe('Oven broke');
    expect(declineReasonLabel('other', null)).toBeNull();
  });

  it('has no reason for a request declined before spec 10b', () => {
    expect(declineReasonLabel(null, null)).toBeNull();
    expect(declinedLine(declineReasonLabel(null, null))).toBe('Declined');
  });
});

describe('answer copy', () => {
  it('words the answer as plain text', () => {
    expect(declinedLine('Sold out')).toBe('Declined: Sold out');
    expect(sellerNoteLine('Please bring a bag')).toBe("Seller's note: Please bring a bag");
  });

  it('counts in words', () => {
    expect(counterText(12, 200)).toBe('12 of 200');
  });

  it('keeps the homemade address hint', () => {
    expect(ACCEPT_ADDRESS_HINT).toBe(
      "Your address is shared automatically after you accept, so don't type it here",
    );
  });

  it('says what the two new errors mean, and never blames the app version', () => {
    expect(actionErrorMessage('decline_reason_required')).toBe('Choose a reason before declining.');
    expect(actionErrorMessage('invalid_text')).toMatch(/characters we can't send/);
    expect(actionErrorMessage('decline_reason_required')).not.toMatch(/update/i);
  });
});
