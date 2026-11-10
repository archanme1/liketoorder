import {
  TABLE_DECLINE_REASON_ORDER,
  declineReasonLabel,
  tableDeclineReasonText,
} from '../declineReasons';

describe('table decline reasons', () => {
  it('are the five in the picker order, Other last', () => {
    expect(TABLE_DECLINE_REASON_ORDER.map(tableDeclineReasonText)).toEqual([
      'Fully booked',
      'Closed at that time',
      'Too busy right now',
      "Time doesn't work",
      'Other',
    ]);
  });

  it('read by kind: the same code can have different words', () => {
    expect(declineReasonLabel('table', 'time_not_possible', null)).toBe("Time doesn't work");
    expect(declineReasonLabel('pickup', 'time_not_possible', null)).toBe(
      "Pickup time doesn't work",
    );
    expect(declineReasonLabel('table', 'fully_booked', null)).toBe('Fully booked');
  });

  it("Other is the seller's own words, or nothing", () => {
    expect(declineReasonLabel('table', 'other', 'Private party')).toBe('Private party');
    expect(declineReasonLabel('table', 'other', null)).toBeNull();
    expect(declineReasonLabel('table', null, null)).toBeNull();
  });
});
