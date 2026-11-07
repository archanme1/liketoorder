import { MAX_LEAD_DAYS, MIN_LEAD_MINUTES } from './schema';

// Times arrive and are sent as UTC instants. They are shown, and grouped into days, in a time zone
// that is always passed in explicitly: the phone's by default, any other zone in tests.

const QUARTER_HOUR_MS = 15 * 60_000;

export type TimeOptions = {
  /** An IANA zone such as "Pacific/Auckland". Defaults to the phone's. */
  timeZone?: string;
  /** A BCP 47 tag such as "en-CA". Defaults to the phone's. */
  locale?: string;
};

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** The calendar date of an instant in `timeZone`, as "YYYY-MM-DD". */
export function localDateKey(date: Date, timeZone: string = deviceTimeZone()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function formatDay(date: Date, { timeZone, locale }: TimeOptions = {}): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timeZone ?? deviceTimeZone(),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatFullDay(date: Date, { timeZone, locale }: TimeOptions = {}): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timeZone ?? deviceTimeZone(),
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function formatTime(date: Date, { timeZone, locale }: TimeOptions = {}): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timeZone ?? deviceTimeZone(),
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** "Sat, Nov 7, 6:00 PM" for a UTC timestamp, in the chosen zone. */
export function formatDateTime(value: string | Date, options: TimeOptions = {}): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${formatDay(date, options)}, ${formatTime(date, options)}`;
}

/** The first pickup time offered: now + 15 minutes (plus one minute of slack), rounded up. */
export function earliestPickup(now: Date): Date {
  const wanted = now.getTime() + (MIN_LEAD_MINUTES + 1) * 60_000;
  return new Date(Math.ceil(wanted / QUARTER_HOUR_MS) * QUARTER_HOUR_MS);
}

/** The last pickup time offered: now + 7 days, rounded down. */
export function latestPickup(now: Date): Date {
  const wanted = now.getTime() + MAX_LEAD_DAYS * 24 * 60 * 60_000;
  return new Date(Math.floor(wanted / QUARTER_HOUR_MS) * QUARTER_HOUR_MS);
}

export type PickupDay = {
  /** The local calendar date, "YYYY-MM-DD" in the chosen zone. */
  key: string;
  /** "Today" or "Sat, Nov 7". */
  label: string;
  /** "Saturday, November 7", for screen readers. */
  spokenLabel: string;
  /** Quarter-hour pickup times on that local date, oldest first. */
  slots: Date[];
};

/**
 * Every offered pickup time, grouped by the local date in `timeZone`. Quarter hours are steps of
 * 15 minutes on the clock; every real zone's offset is a multiple of 15 minutes, so stepping the
 * UTC instant lands on local quarter hours too. The grouping is what must use the zone: grouping
 * by UTC would put late-evening slots under the wrong day.
 */
export function buildPickupDays(now: Date, options: TimeOptions = {}): PickupDay[] {
  const timeZone = options.timeZone ?? deviceTimeZone();
  const zoned = { ...options, timeZone };
  const today = localDateKey(now, timeZone);
  const days: PickupDay[] = [];
  const end = latestPickup(now).getTime();
  for (let t = earliestPickup(now).getTime(); t <= end; t += QUARTER_HOUR_MS) {
    const slot = new Date(t);
    const key = localDateKey(slot, timeZone);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = {
        key,
        label: key === today ? 'Today' : formatDay(slot, zoned),
        spokenLabel: formatFullDay(slot, zoned),
        slots: [],
      };
      days.push(day);
    }
    day.slots.push(slot);
  }
  return days;
}
