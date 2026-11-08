import { MAX_LEAD_DAYS, MIN_LEAD_MINUTES, type PickupTimeProblem } from './schema';

// Times arrive and are sent as UTC instants. They are shown, and worked on as calendar days and
// wall-clock times, in a time zone that is always passed in explicitly: the phone's by default,
// any other zone in tests.

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

function formatDay(date: Date, { timeZone, locale }: TimeOptions = {}): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timeZone ?? deviceTimeZone(),
    weekday: 'short',
    month: 'short',
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

/** Rounds an instant to the nearest quarter hour. Every real zone's offset is a multiple of 15 minutes, so this is a quarter hour on the local clock too. */
export function snapToQuarter(date: Date): Date {
  return new Date(Math.round(date.getTime() / QUARTER_HOUR_MS) * QUARTER_HOUR_MS);
}

/**
 * Snaps a chosen time to a quarter hour and keeps it inside what the server accepts (from
 * earliestPickup to latestPickup). `problem` says which side it was outside of, and `value` is the
 * nearest allowed time. The Android time dialog ignores minimum and maximum dates, so this is what
 * enforces them there; on iOS it is a safety net.
 */
export function clampToWindow(
  date: Date,
  now: Date,
): { value: Date; problem: PickupTimeProblem | null } {
  const snapped = snapToQuarter(date);
  const earliest = earliestPickup(now);
  const latest = latestPickup(now);
  if (snapped.getTime() < earliest.getTime()) return { value: earliest, problem: 'too_soon' };
  if (snapped.getTime() > latest.getTime()) return { value: latest, problem: 'too_far' };
  return { value: snapped, problem: null };
}

type Wall = { year: number; month: number; day: number; hour: number; minute: number };

function wallOf(instant: Date, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
  };
}

const sameWall = (a: Wall, b: Wall) =>
  a.year === b.year &&
  a.month === b.month &&
  a.day === b.day &&
  a.hour === b.hour &&
  a.minute === b.minute;

/** The UTC offset of `timeZone` at `instant`, in ms (whole minutes). */
function offsetMs(instant: Date, timeZone: string): number {
  const wall = wallOf(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/**
 * The instant at which the clock in `timeZone` shows `wall`. A time that happens twice (the clocks
 * go back) is the first one; a time that never happens (the clocks jump forward) is moved ahead by
 * the length of the gap, so 02:30 on a spring-forward night becomes 03:30.
 */
export function wallTimeToInstant(wall: Wall, timeZone: string): Date {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const day = 24 * 60 * 60_000;
  const before = offsetMs(new Date(guess - day), timeZone);
  const after = offsetMs(new Date(guess + day), timeZone);
  const valid = [before, after]
    .map((offset) => new Date(guess - offset))
    .filter((candidate) => sameWall(wallOf(candidate, timeZone), wall))
    .sort((a, b) => a.getTime() - b.getTime());
  if (valid.length > 0) return valid[0];
  return new Date(guess - before);
}

/**
 * The calendar day of `dateSource` with the wall-clock time of `timeSource`, in `timeZone`. The
 * Android flow picks the day and the time in two dialogs; this joins them without depending on
 * what the native dialogs do with the time of day, or on the phone's zone.
 */
export function combineDateAndTime(dateSource: Date, timeSource: Date, timeZone: string): Date {
  const day = wallOf(dateSource, timeZone);
  const time = wallOf(timeSource, timeZone);
  return wallTimeToInstant(
    { year: day.year, month: day.month, day: day.day, hour: time.hour, minute: time.minute },
    timeZone,
  );
}
