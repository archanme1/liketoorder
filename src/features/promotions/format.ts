import { getLocales } from 'expo-localization';

import { minorToDecimalString } from '@/features/menu/price';
import { deviceTimeZone } from '@/features/requests/time';
import { addDays } from '@/lib/localDate';

import { CANCELLED_TEXT, REJECT_REASON_TEXT, REQUESTED_TEXT } from './messages';
import type { Promotion } from './schema';
import { MAX_HEADLINE_CHARS } from './text';

// Price, dates and counter wording for the Promote screen. Pure: the locale and the zone are always
// passed in (the phone's by default, any other in tests). Instants are shown in the zone; date-only
// strings ("2026-12-02") are calendar days and never move with a zone.

export type FormatOptions = {
  /** A BCP 47 tag such as "en-CA". Defaults to the phone's. */
  locale?: string;
  /** An IANA zone such as "America/Toronto". Defaults to the phone's. */
  timeZone?: string;
};

export function phoneLocale(): string {
  return getLocales()[0]?.languageTag ?? 'en-US';
}

/**
 * "CAD 25.00": the ISO code (an invoice is in that currency, so no symbol that could be another
 * dollar), the currency's own decimals, and the amount as a decimal string, so no float maths.
 */
export function formatPromotionPrice(cents: number, currency: string, locale = phoneLocale()) {
  const digits =
    new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const format = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  // The amount goes in as a decimal string such as "25.00", built from the integer cents with
  // string steps only. The cast is because TypeScript's Intl type accepts only numbers. An engine
  // whose Intl takes decimal strings (the newer spec) formats that exact value. An older one, possibly
  // Hermes on a phone, turns the string into a Number first: that is still exact for any whole number
  // of cents below 2^53, far above any promotion price, so no rounding can show. Same approach as
  // formatPrice in src/features/menu/price.ts.
  return format.format(minorToDecimalString(cents, digits) as unknown as number);
}

/** "CAD 25.00 for 7 days". */
export function offerLine(price: string, lengthDays: number): string {
  return `${price} for ${lengthDays} ${lengthDays === 1 ? 'day' : 'days'}`;
}

/** "Dec 2" (en-CA) or "2 Dec" (en-GB) for an instant, in the zone. */
export function formatPromotionDay(iso: string, { locale, timeZone }: FormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale ?? phoneLocale(), {
    timeZone: timeZone ?? deviceTimeZone(),
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

/** The status sentence for the seller's own campaign. Pending is never worded as approved. */
export function statusText(promotion: Promotion, options: FormatOptions = {}): string {
  const day = (iso: string | null) => (iso === null ? '' : formatPromotionDay(iso, options));
  switch (promotion.state) {
    case 'requested':
      return REQUESTED_TEXT;
    case 'scheduled':
      return `Starts on ${day(promotion.starts_at)}, ends on ${day(promotion.ends_at)}.`;
    case 'active':
      return `Promoted until ${day(promotion.ends_at)}.`;
    case 'ended':
      return `Ended on ${day(promotion.ends_at)}.`;
    case 'rejected':
      // The schema guarantees a reason on a rejected campaign.
      return `Not approved: ${REJECT_REASON_TEXT[promotion.reject_reason ?? 'other']}`;
    case 'cancelled':
      return CANCELLED_TEXT;
  }
}

/** The calendar day of `now` on the phone ("2026-12-01"), in the zone. */
export function localToday(now: Date, timeZone: string = deviceTimeZone()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export const START_DAY_COUNT = 14;

/**
 * The preferred-start chips after "As soon as possible": tomorrow and the days after it. The server
 * accepts its UTC date minus 1 to plus 90, and a phone's date is always within a day of the UTC
 * date, so these are always accepted while the phone's clock is right.
 */
export function startDayOptions(today: string, count: number = START_DAY_COUNT): string[] {
  return Array.from({ length: count }, (_, i) => addDays(today, i + 1));
}

function formatCalendarDay(date: string, locale: string | undefined, long: boolean): string {
  return new Intl.DateTimeFormat(locale ?? phoneLocale(), {
    timeZone: 'UTC',
    weekday: long ? 'long' : 'short',
    month: long ? 'long' : 'short',
    day: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** "Tue, Dec 2" for a chip. */
export function formatChipDay(date: string, locale?: string): string {
  return formatCalendarDay(date, locale, false);
}

/** "Tuesday, December 2", the chip's spoken label. */
export function formatChipDayLong(date: string, locale?: string): string {
  return formatCalendarDay(date, locale, true);
}

/** The counter's spoken label: "12 of 60 characters", plus ", too long" over the limit. */
export function counterLabel(length: number): string {
  const over = length > MAX_HEADLINE_CHARS ? ', too long' : '';
  return `${length} of ${MAX_HEADLINE_CHARS} characters${over}`;
}

const NEAR_LIMIT = MAX_HEADLINE_CHARS - 10;

/**
 * What to announce when the headline length changes, or null. Only when a threshold is crossed,
 * never on every keystroke: near the limit, at the limit, over it.
 */
export function counterAnnouncement(before: number, after: number): string | null {
  if (after > MAX_HEADLINE_CHARS) {
    return before <= MAX_HEADLINE_CHARS ? 'Headline too long' : null;
  }
  if (after === MAX_HEADLINE_CHARS) {
    return before === MAX_HEADLINE_CHARS ? null : `${MAX_HEADLINE_CHARS} characters, the limit`;
  }
  if (after >= NEAR_LIMIT && before < NEAR_LIMIT) {
    const left = MAX_HEADLINE_CHARS - after;
    return `${left} ${left === 1 ? 'character' : 'characters'} left`;
  }
  return null;
}
