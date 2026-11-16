// Pure helpers on date-only strings ("2026-11-12"). A date here is a calendar day, never an
// instant: every step goes through Date.UTC and the getUTC* getters, so the phone's zone and
// daylight saving can never move a day. Nothing here reads the phone clock; callers pass "today"
// (the server's, spec 14).

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const match = DATE.exec(date);
  if (!match) throw new Error(`Not a date: ${date}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${month}-${day}`;
}

/** The date n days later (n may be negative). */
export function addDays(date: string, n: number): string {
  return fromUtcMs(toUtcMs(date) + n * DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(date: string): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

/** Negative, 0 or positive, like a sort comparator. */
export function compareDates(a: string, b: string): number {
  return Math.sign(toUtcMs(a) - toUtcMs(b));
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

// Building an Intl.DateTimeFormat is slow (notably on Hermes) and the grid formats up to 371 days
// per render, so one formatter is kept per kind and locale.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(kind: 'day' | 'month', locale: string | undefined): Intl.DateTimeFormat {
  const key = `${kind}|${locale ?? ''}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(
      locale,
      kind === 'day'
        ? { timeZone: 'UTC', month: 'short', day: 'numeric' }
        : { timeZone: 'UTC', month: 'short' },
    );
    formatters.set(key, cached);
  }
  return cached;
}

/** "Nov 12" for "2026-11-12". */
export function formatShortDate(date: string, locale?: string): string {
  return formatter('day', locale).format(new Date(toUtcMs(date)));
}

/** "Nov" for "2026-11-12". */
export function formatShortMonth(date: string, locale?: string): string {
  return formatter('month', locale).format(new Date(toUtcMs(date)));
}
