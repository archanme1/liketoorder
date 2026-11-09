import {
  MAX_ANSWER_NOTE,
  declineReasonSchema,
  pickupRequestSchema,
  respondInputSchema,
  respondOptions,
  sellerRequestSchema,
} from '../schema';

import { makeRequest } from '../__fixtures__/requests';
import { makeSellerRequest } from '../__fixtures__/sellerRequests';

describe('the seller answer keys (spec 10b)', () => {
  it('requires decline_reason and response_note on the customer object, nullable', () => {
    expect(pickupRequestSchema.safeParse(makeRequest()).success).toBe(true);
    const { decline_reason: _reason, ...withoutReason } = makeRequest();
    const { response_note: _note, ...withoutNote } = makeRequest();
    expect(pickupRequestSchema.safeParse(withoutReason).success).toBe(false);
    expect(pickupRequestSchema.safeParse(withoutNote).success).toBe(false);
  });

  it('requires them on the seller object too, and stays strict', () => {
    expect(sellerRequestSchema.safeParse(makeSellerRequest()).success).toBe(true);
    const { response_note: _note, ...withoutNote } = makeSellerRequest();
    expect(sellerRequestSchema.safeParse(withoutNote).success).toBe(false);
    expect(
      sellerRequestSchema.safeParse({ ...makeSellerRequest(), accepted_address: 'x' }).success,
    ).toBe(false);
  });

  it('reads a declined row with each reason, and an accepted row with a note', () => {
    for (const reason of declineReasonSchema.options) {
      const row = makeRequest({
        status: 'declined',
        display_status: 'declined',
        decline_reason: reason,
        response_note: reason === 'other' ? 'We closed early' : null,
      });
      expect(pickupRequestSchema.safeParse(row).success).toBe(true);
    }
    const accepted = makeRequest({
      status: 'accepted',
      display_status: 'accepted',
      response_note: 'Please bring a bag',
    });
    expect(pickupRequestSchema.safeParse(accepted).success).toBe(true);
  });

  it('refuses an unknown reason code and a note over 200 characters', () => {
    expect(
      pickupRequestSchema.safeParse(makeRequest({ decline_reason: 'rude' as never })).success,
    ).toBe(false);
    expect(
      pickupRequestSchema.safeParse(makeRequest({ response_note: 'x'.repeat(201) })).success,
    ).toBe(false);
  });
});

describe('respondInputSchema (the dialogs)', () => {
  it('accepts an accept with no note, a note, and a note of exactly 200 characters', () => {
    expect(respondInputSchema.safeParse({ decision: 'accepted', note: '' }).success).toBe(true);
    expect(respondInputSchema.safeParse({ decision: 'accepted', note: 'Bring a bag' }).success).toBe(
      true,
    );
    const edge = respondInputSchema.safeParse({
      decision: 'accepted',
      note: 'x'.repeat(MAX_ANSWER_NOTE),
    });
    expect(edge.success).toBe(true);
    expect(
      respondInputSchema.safeParse({ decision: 'accepted', note: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('trims and strips hidden characters, and counts a blank note as none', () => {
    const parsed = respondInputSchema.parse({ decision: 'accepted', note: '  \u200Bhi\u202E  ' });
    expect(parsed).toEqual({ decision: 'accepted', note: 'hi' });
    expect(respondInputSchema.parse({ decision: 'accepted', note: ' \u200B ' })).toEqual({
      decision: 'accepted',
      note: '',
    });
  });

  it('needs a reason to decline, and written words for Other', () => {
    expect(respondInputSchema.safeParse({ decision: 'declined', text: '' }).success).toBe(false);
    expect(
      respondInputSchema.safeParse({ decision: 'declined', reason: 'sold_out', text: '' }).success,
    ).toBe(true);
    expect(
      respondInputSchema.safeParse({ decision: 'declined', reason: 'other', text: '   ' }).success,
    ).toBe(false);
    expect(
      respondInputSchema.safeParse({ decision: 'declined', reason: 'other', text: 'x'.repeat(201) })
        .success,
    ).toBe(false);
    expect(
      respondInputSchema.safeParse({ decision: 'declined', reason: 'other', text: 'x' }).success,
    ).toBe(true);
  });
});

describe('respondOptions (what is sent)', () => {
  it('sends nothing for an accept with an empty note', () => {
    expect(respondOptions({ decision: 'accepted', note: '' })).toBeUndefined();
  });

  it('sends the note on an accept', () => {
    expect(respondOptions({ decision: 'accepted', note: 'Bring a bag' })).toEqual({
      note: 'Bring a bag',
    });
  });

  it('sends only the code for a fixed reason, even if text was typed before switching', () => {
    expect(respondOptions({ decision: 'declined', reason: 'sold_out', text: 'left over' })).toEqual({
      declineReason: 'sold_out',
    });
  });

  it('sends the written words as the note for Other', () => {
    expect(respondOptions({ decision: 'declined', reason: 'other', text: 'Oven broke' })).toEqual({
      declineReason: 'other',
      note: 'Oven broke',
    });
  });
});
