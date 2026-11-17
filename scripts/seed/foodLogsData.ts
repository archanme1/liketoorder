// Pure planning for the food log seed (spec 14 Decision 10): about 6 months of uneven uploads for
// one demo account, so the activity grid, its stats and the day panel have something to show.
// Unit-tested; the seed script (foodLogs.ts) only writes what this plans.

export const FOOD_LOG_PASSWORD = 'password123';

export type FoodLogSeedAccount = {
  email: string;
  username: string;
  displayName: string;
  /** false: the empty-state account, with no uploads. */
  withLogs: boolean;
};

export const FOOD_LOG_ACCOUNTS: readonly FoodLogSeedAccount[] = [
  {
    email: 'seed-foodlog@example.com',
    username: 'seed_foodlog',
    displayName: 'Food Log Demo',
    withLogs: true,
  },
  {
    email: 'seed-foodlog-empty@example.com',
    username: 'seed_foodlog_empty',
    displayName: 'Empty Food Log',
    withLogs: false,
  },
];

/**
 * The seed writes as the service role, so begin_food_log_upload's 20 starts a day never applies.
 * The plan keeps every date at 6 or fewer itself, well inside list_my_food_logs_on's 60-row limit.
 */
export const MAX_PER_DATE = 6;
export const DAYS_BACK = 182;

// Codes present in the cuisine catalog migration, the neutral ones included.
export const SEED_CUISINES = ['IT', 'JP', 'MX', 'IN', 'TH', 'street-food', 'fusion', 'other'];

export type PlannedFoodLog = {
  /** The author's local day, YYYY-MM-DD, in the seed's time zone. */
  localDate: string;
  /** ISO instant; within the UTC date +/-1 of localDate (food_logs_local_date_near), never after now. */
  createdAt: string;
  cuisineCode: string;
  description: string | null;
  isPublic: boolean;
};

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** The calendar date of `instant` in `timeZone`, as YYYY-MM-DD. */
export function dateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** How far `timeZone` is ahead of UTC at `instant`, in ms. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant of `hour`:00 local time on `date` in `timeZone` (two passes cover a clock change). */
export function localTimeToInstant(date: string, hour: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hour);
  let instant = wall - zoneOffsetMs(new Date(wall), timeZone);
  instant = wall - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** Uploads on the day `offset` days before today. Deterministic, so the tests can pin the shape. */
export function uploadsOn(offset: number): number {
  // Today has none, so the current streak is the run ending yesterday; it is 6 days long.
  const recent = [0, 2, 1, 5, 1, 3, 1, 0];
  if (offset < recent.length) return recent[offset];
  if (offset === 20) return MAX_PER_DATE;
  // Days 40 to 52 all have uploads: with their neighbours, the longest run (about two weeks).
  if (offset >= 40 && offset <= 52) return 1 + (offset % 3);
  // Elsewhere an uneven pattern: zero on 4 of every 10 days, so runs stay short.
  const h = (offset * 37 + 11) % 10;
  if (h < 4) return 0;
  if (h < 7) return 1;
  if (h < 9) return 2;
  return 4;
}

/** Throws unless Intl knows the zone (an IANA name such as Europe/Paris). */
export function assertTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error(`Unknown time zone "${timeZone}". Use an IANA name like Europe/Paris.`);
  }
  return timeZone;
}

/** --tz <IANA name>; otherwise the fallback (this Mac's zone). */
export function parseTimeZone(argv: readonly string[], fallback: string): string {
  const index = argv.indexOf('--tz');
  if (index === -1) return assertTimeZone(fallback);
  const value = argv[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error('--tz needs a time zone, e.g. --tz Asia/Tokyo');
  return assertTimeZone(value);
}

export function planFoodLogs(now: Date, timeZone: string): PlannedFoodLog[] {
  assertTimeZone(timeZone);
  const today = dateInZone(now, timeZone);
  const plans: PlannedFoodLog[] = [];
  let n = 0;
  for (let offset = DAYS_BACK; offset >= 1; offset--) {
    const count = uploadsOn(offset);
    if (count > MAX_PER_DATE) throw new Error(`Planned ${count} uploads on one date.`);
    const localDate = shiftDate(today, -offset);
    for (let i = 0; i < count; i++) {
      n++;
      // 08:00, 11:00, ... 23:00 local: up to 6 a day, in order.
      let created = localTimeToInstant(localDate, 8 + i * 3, timeZone);
      if (created.getTime() > now.getTime()) {
        created = new Date(now.getTime() - (count - i) * MINUTE_MS);
      }
      const utcDate = created.toISOString().slice(0, 10);
      if (localDate < shiftDate(utcDate, -1) || localDate > shiftDate(utcDate, 1)) {
        throw new Error(`Planned ${localDate} too far from ${created.toISOString()}.`);
      }
      plans.push({
        localDate,
        createdAt: created.toISOString(),
        // Rotates within a day, so busy days mix cuisines.
        cuisineCode: SEED_CUISINES[(offset + i) % SEED_CUISINES.length],
        description: n % 7 === 0 ? null : `Demo meal ${n}`,
        isPublic: n % 5 !== 0,
      });
    }
  }
  return plans;
}
