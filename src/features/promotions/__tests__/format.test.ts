import { NOW, promotionJson } from '../__fixtures__/promotion';
import {
  counterAnnouncement,
  counterLabel,
  formatChipDay,
  formatChipDayLong,
  campaignLength,
  formatPromotionDay,
  invitationText,
  localToday,
  startDayOptions,
  statusText,
} from '../format';
import * as formatModule from '../format';
import { REJECT_REASON_TEXT } from '../messages';
import { promotionSchema, type Promotion } from '../schema';

const TORONTO = { locale: 'en-CA', timeZone: 'America/Toronto' };

function promotion(state: Parameters<typeof promotionJson>[0], overrides = {}): Promotion {
  return promotionSchema.parse(promotionJson(state, overrides));
}

describe('campaignLength and invitationText (no price, spec 16b D15)', () => {
  it('says "for 7 days", and "for 1 day" for one', () => {
    expect(campaignLength(7)).toBe('for 7 days');
    expect(campaignLength(1)).toBe('for 1 day');
  });

  it('words the invitation with the length and the Sponsored mark, and no price', () => {
    expect(invitationText(7)).toBe(
      'A larger flag on the map and a card in Offers for 7 days, both marked Sponsored.',
    );
    expect(invitationText(7)).not.toMatch(/\$|CAD|price|pay|[0-9]+[.,][0-9]{2}/i);
  });

  it('no longer exports a price formatter', () => {
    const exported: Record<string, unknown> = { ...formatModule };
    expect(exported.formatPromotionPrice).toBeUndefined();
    expect(exported.offerLine).toBeUndefined();
  });
});

describe('formatPromotionDay', () => {
  const iso = '2026-12-02T14:00:00.000Z';

  it('uses the locale order: "Dec 2" in en-CA, "2 Dec" in en-GB', () => {
    expect(formatPromotionDay(iso, TORONTO)).toBe('Dec 2');
    expect(formatPromotionDay(iso, { locale: 'en-GB', timeZone: 'Europe/London' })).toBe('2 Dec');
  });

  it('uses the passed zone: the same instant is the next day in Auckland', () => {
    const late = '2026-12-02T23:30:00.000Z';
    expect(formatPromotionDay(late, TORONTO)).toBe('Dec 2');
    expect(formatPromotionDay(late, { locale: 'en-CA', timeZone: 'Pacific/Auckland' })).toBe(
      'Dec 3',
    );
  });
});

describe('statusText', () => {
  it('words every state', () => {
    expect(statusText(promotion('requested'), TORONTO)).toBe('Waiting for review.');
    expect(statusText(promotion('scheduled'), TORONTO)).toBe(
      'Scheduled. Starts on Nov 22, ends on Nov 29.',
    );
    expect(statusText(promotion('active'), TORONTO)).toBe('Active until Nov 24.');
    expect(statusText(promotion('ended'), TORONTO)).toBe('Ended on Nov 17.');
    expect(statusText(promotion('cancelled'), TORONTO)).toBe('Cancelled.');
  });

  it.each(['headline', 'not_paid', 'not_eligible', 'other'] as const)(
    'gives the reason for a rejection (%s)',
    (reason) => {
      expect(statusText(promotion('rejected', { reject_reason: reason }), TORONTO)).toBe(
        `Not approved: ${REJECT_REASON_TEXT[reason]}`,
      );
    },
  );

  it('never words a waiting request as approved or promoted', () => {
    expect(statusText(promotion('requested'), TORONTO)).not.toMatch(/approved|promoted|starts/i);
  });
});

describe('the preferred-start days', () => {
  it("takes today's date in the phone's zone", () => {
    // 15:00 UTC is 10:00 in Toronto and 04:00 the next day in Auckland.
    expect(localToday(NOW, 'America/Toronto')).toBe('2026-11-20');
    expect(localToday(NOW, 'Pacific/Auckland')).toBe('2026-11-21');
    expect(localToday(new Date('2026-11-21T03:00:00Z'), 'America/Toronto')).toBe('2026-11-20');
  });

  it('offers the 14 days from tomorrow, across a month and a year end', () => {
    const days = startDayOptions('2026-12-25');
    expect(days).toHaveLength(14);
    expect(days[0]).toBe('2026-12-26');
    expect(days).toContain('2027-01-01');
    expect(days[13]).toBe('2027-01-08');
  });

  it('labels a chip short and speaks it long, never moved by a zone', () => {
    expect(formatChipDay('2026-12-01', 'en-CA')).toBe('Tue, Dec 1');
    expect(formatChipDayLong('2026-12-01', 'en-CA')).toBe('Tuesday, December 1');
    expect(formatChipDay('2026-12-01', 'en-GB')).toBe('Tue 1 Dec');
  });
});

describe('the headline counter', () => {
  it('reads "12 of 60 characters", and says too long over 60', () => {
    expect(counterLabel(12)).toBe('12 of 60 characters');
    expect(counterLabel(61)).toBe('61 of 60 characters, too long');
  });

  it('announces only when a threshold is crossed', () => {
    expect(counterAnnouncement(49, 50)).toBe('10 characters left');
    expect(counterAnnouncement(10, 59)).toBe('1 character left');
    expect(counterAnnouncement(50, 51)).toBeNull();
    expect(counterAnnouncement(59, 60)).toBe('60 characters, the limit');
    expect(counterAnnouncement(60, 60)).toBeNull();
    expect(counterAnnouncement(60, 61)).toBe('Headline too long');
    expect(counterAnnouncement(61, 62)).toBeNull();
    expect(counterAnnouncement(62, 55)).toBeNull();
    expect(counterAnnouncement(3, 4)).toBeNull();
  });
});

describe('statusText: spec 16b states', () => {
  it('words the three new states in the spec 16b wording', () => {
    expect(statusText(promotion('awaiting_payment'), TORONTO)).toBe(
      "Your headline was approved. We'll be in touch with next steps.",
    );
    expect(statusText(promotion('payment_expired'), TORONTO)).toBe('Payment window closed.');
    expect(statusText(promotion('refunded'), TORONTO)).toBe('Refunded.');
  });

  it('says "Paid and scheduled" for a paid campaign and "Scheduled" for a free one', () => {
    const paid = { paid: true, is_free: false };
    expect(statusText(promotion('scheduled', paid), TORONTO)).toBe(
      'Paid and scheduled. Starts on Nov 22, ends on Nov 29.',
    );
    expect(statusText(promotion('scheduled'), TORONTO)).toBe(
      'Scheduled. Starts on Nov 22, ends on Nov 29.',
    );
    expect(statusText(promotion('active', paid), TORONTO)).toBe('Active until Nov 24.');
    expect(statusText(promotion('active'), TORONTO)).toBe('Active until Nov 24.');
  });

  it('words a not_paid rejection as the closed payment window', () => {
    expect(statusText(promotion('rejected', { reject_reason: 'not_paid' }), TORONTO)).toBe(
      'Not approved: the payment window closed.',
    );
  });

  it('never puts a price, an amount or payment instructions in the new status lines', () => {
    for (const state of ['awaiting_payment', 'payment_expired', 'refunded'] as const) {
      const text = statusText(promotion(state), TORONTO);
      expect(text).not.toMatch(/\$|CAD|[0-9]|invoice|e-?mail|stripe|online|pay by|card|link/i);
    }
  });

  it('does not call a headline-approved campaign scheduled, active or promoted', () => {
    expect(statusText(promotion('awaiting_payment'), TORONTO)).not.toMatch(
      /scheduled|active|promoted|starts/i,
    );
  });
});
