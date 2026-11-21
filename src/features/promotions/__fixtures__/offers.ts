// Test data for spec 16 Offers. The fake follows list_offers_near in 20261120214854_promotions.sql:
// the same checks in the same order (point, distance, filters, cursor, then the quota), the same
// 4 km margin, bands, daily rotation (md5 of id and UTC day), keyset paging of 20 with one extra
// row to know if more exist, the same cursor text, and PostgREST-shaped errors.
import { pgError } from './promotion';

type Json = Record<string, unknown>;

export const OFFER_ID = '00000000-0000-4000-8000-000000001701';

/** The fixture clock: Friday 20 Nov 2026, 15:00 UTC (the same day as promotion.ts's NOW). */
export const OFFERS_NOW = new Date('2026-11-20T15:00:00.000Z');

/** Offer ids that sort like their number: 00000000-0000-4000-8000-00000000NNNN. */
export function offerId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** One offer exactly as the server builds it (12 keys). Near Oshawa unless overridden. */
export function makeOffer(overrides: Json = {}): Json {
  return {
    business_id: OFFER_ID,
    type: 'restaurant',
    name: 'Simcoe Street Pho',
    cuisine_code: 'VN',
    lat: 43.8971,
    lng: -78.8658,
    accepts_table_requests: true,
    category: 'special_offer',
    headline: 'Two bowls of pho for the price of one',
    ends_at: '2026-11-24T15:00:00+00:00',
    band: 0,
    cover: null,
    ...overrides,
  };
}

export const COVER_JSON = {
  id: '00000000-0000-4000-8000-000000001799',
  kind: 'cover',
  path: '11111111-1111-4111-8111-111111111111/cover/a.jpg',
  position: null,
  menu_item_id: null,
};

const EARTH_KM = 6371.0088;
const MARGIN_KM = 4;
const PAGE = 20;
const CURSOR =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-2]\|[0-9a-f]{32}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY_MS = 86_400_000;

const rad = (d: number) => (d * Math.PI) / 180;
// MD5 (RFC 1321), as Postgres md5() computes it: the hex digest of the UTF-8 bytes. Here the input
// is always ASCII (a uuid and a YYYY-MM-DD day). Test-only; checked against the RFC vectors.
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = Array.from(
  { length: 64 },
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
);

export function md5(text: string): string {
  const bytes = Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i += 1) bytes.push(i < 4 ? (bitLength >>> (8 * i)) & 0xff : 0);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    const m = Array.from(
      { length: 16 },
      (_, j) =>
        (bytes[chunk + 4 * j] |
          (bytes[chunk + 4 * j + 1] << 8) |
          (bytes[chunk + 4 * j + 2] << 16) |
          (bytes[chunk + 4 * j + 3] << 24)) >>>
        0,
    );
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + MD5_K[i] + m[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((word) =>
      [0, 8, 16, 24]
        .map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, '0'))
        .join(''),
    )
    .join('');
}
const utcDay = (date: Date) => date.toISOString().slice(0, 10);

function km(lat: number, lng: number, toLat: number, toLng: number): number {
  return (
    2 *
    EARTH_KM *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(rad(toLat - lat) / 2) ** 2 +
            Math.cos(rad(lat)) * Math.cos(rad(toLat)) * Math.sin(rad(toLng - lng) / 2) ** 2,
        ),
      ),
    )
  );
}

const offGrid = (v: number) => Math.abs(v * 20 - Math.round(v * 20)) > 1e-9;

/** A real calendar day (to_date refuses 2026-02-30). */
function validDay(text: string): Date | null {
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && utcDay(date) === text ? date : null;
}

export type OffersCall = {
  p_lat: number;
  p_lng: number;
  p_distance_km: number;
  p_category: string | null;
  p_type: string | null;
  p_tables: boolean | null;
  p_cursor: string | null;
};

export type OffersServer = {
  /** Every active offer the database holds (the server's own filters still apply). */
  rows: Json[];
  /** The server clock. */
  now: Date;
  /** Calls allowed before rate_limited (the quota runs after validation). */
  quota: number;
  /** When set, the next call answers this error instead (then it clears). */
  failNext: Json | null;
  /** When set, every call answers this error. */
  failAlways: Json | null;
  /** When set, the next call answers this data untouched (then it clears). */
  answerNext: unknown;
  calls: OffersCall[];
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export function createOffersServer({
  rows = [] as Json[],
  now = OFFERS_NOW,
  quota = Number.POSITIVE_INFINITY,
} = {}): OffersServer {
  const server: OffersServer = {
    rows,
    now,
    quota,
    failNext: null,
    failAlways: null,
    answerNext: undefined,
    calls: [],
    rpc: async (name, args = {}) => {
      if (name !== 'list_offers_near') {
        return { data: null, error: { code: 'PGRST202', message: `unknown ${name}` } };
      }
      const call = args as unknown as OffersCall;
      server.calls.push(call);
      if (server.failAlways) return { data: null, error: server.failAlways };
      if (server.failNext) {
        const error = server.failNext;
        server.failNext = null;
        return { data: null, error };
      }
      if (server.answerNext !== undefined) {
        const data = server.answerNext;
        server.answerNext = undefined;
        return { data, error: null };
      }
      return answer(server, call);
    },
  };
  return server;
}

function answer(server: OffersServer, call: OffersCall): { data: unknown; error: unknown } {
  const { p_lat: lat, p_lng: lng, p_distance_km: distance, p_category, p_type, p_tables } = call;
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    Number.isNaN(lat) ||
    Number.isNaN(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    offGrid(lat) ||
    offGrid(lng)
  ) {
    return { data: null, error: pgError('invalid_point') };
  }
  if (![5, 15, 30].includes(distance)) return { data: null, error: pgError('invalid_distance') };
  if (
    (p_category != null && !['new_dish', 'special_offer', 'featured'].includes(p_category)) ||
    (p_type != null && !['restaurant', 'homemade'].includes(p_type))
  ) {
    return { data: null, error: pgError('invalid_filter') };
  }

  const today = validDay(utcDay(server.now)) as Date;
  let day = today;
  let after: { band: number; rot: string; id: string } | null = null;
  if (call.p_cursor != null) {
    if (!CURSOR.test(call.p_cursor)) return { data: null, error: pgError('invalid_cursor') };
    const [dayText, band, rot, id] = call.p_cursor.split('|');
    const parsed = validDay(dayText);
    if (!parsed || Math.abs(parsed.getTime() - today.getTime()) > DAY_MS) {
      return { data: null, error: pgError('invalid_cursor') };
    }
    day = parsed;
    after = { band: Number(band), rot, id };
  }

  if (server.quota <= 0) return { data: null, error: pgError('rate_limited') };
  server.quota -= 1;

  const dayText = utcDay(day);
  const radius = distance + MARGIN_KM;
  const ranked = server.rows
    .filter((row) => p_category == null || row.category === p_category)
    .filter((row) => p_type == null || row.type === p_type)
    .filter((row) => p_tables !== true || row.accepts_table_requests === true)
    .map((row) => {
      const d = km(lat, lng, row.lat as number, row.lng as number);
      const id = row.business_id as string;
      return { row, d, id, band: d < 5 ? 0 : d < 15 ? 1 : 2, rot: md5(id + dayText) };
    })
    .filter((r) => r.d <= radius)
    .sort((a, b) => a.band - b.band || cmp(a.rot, b.rot) || cmp(a.id, b.id))
    .filter(
      (r) =>
        !after ||
        r.band > after.band ||
        (r.band === after.band && (r.rot > after.rot || (r.rot === after.rot && r.id > after.id))),
    );

  const page = ranked.slice(0, PAGE + 1);
  const offers = page.slice(0, PAGE).map((r) => ({ ...r.row, band: r.band }));
  if (page.length <= PAGE) return { data: { offers, next_cursor: null }, error: null };
  const last = page[PAGE - 1];
  return {
    data: { offers, next_cursor: `${dayText}|${last.band}|${md5(last.id + dayText)}|${last.id}` },
    error: null,
  };
}

// collate "C": plain code-unit order.
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `count` offers, all within 1 km of Oshawa's grid point, ids 1..count. */
export function manyOffers(count: number, overrides: Json = {}): Json[] {
  return Array.from({ length: count }, (_, i) =>
    makeOffer({
      business_id: offerId(i + 1),
      name: `Place ${i + 1}`,
      lat: 43.9 + ((i % 5) - 2) * 0.001,
      lng: -78.85 + (Math.floor(i / 5) % 5) * 0.001,
      ...overrides,
    }),
  );
}
