/**
 * "Sat, Nov 14, 2026" for a stored local_date ("2026-11-14"). The date is the author's own day,
 * set by the server; it is formatted as a calendar date in UTC, so the phone's zone and the
 * upload's created_at never move it.
 */
export function formatLocalDate(localDate: string, locale?: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
