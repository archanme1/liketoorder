// Test data for spec 16 (seller side). The JSON has exactly the keys of private.promotion_json and
// get_my_promotion, and the fake server below follows request_promotion and cancel_my_promotion in
// 20261120214854_promotions.sql: the same refusals, in the same order, with PostgREST-shaped errors.
import { checkHeadline } from '../text';

/** "Now" for every test: Friday 20 Nov 2026, 10:00 in Toronto. */
export const NOW = new Date('2026-11-20T15:00:00.000Z');
const DAY_MS = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY_MS).toISOString();

export const PROMOTION_ID = '00000000-0000-4000-8000-000000001601';

export const SETTINGS_JSON = { price_cents: 2500, currency_code: 'CAD', length_days: 7 };

type Json = Record<string, unknown>;
type State =
  | 'requested'
  | 'awaiting_payment'
  | 'scheduled'
  | 'active'
  | 'ended'
  | 'rejected'
  | 'cancelled'
  | 'payment_expired'
  | 'refunded';

const WINDOWS: Record<State, { starts_at: string | null; ends_at: string | null }> = {
  requested: { starts_at: null, ends_at: null },
  scheduled: { starts_at: at(2), ends_at: at(9) },
  active: { starts_at: at(-3), ends_at: at(4) },
  ended: { starts_at: at(-10), ends_at: at(-3) },
  rejected: { starts_at: null, ends_at: null },
  cancelled: { starts_at: null, ends_at: null },
  // Spec 16b. A refunded campaign keeps its (cut) window as history.
  awaiting_payment: { starts_at: null, ends_at: null },
  payment_expired: { starts_at: null, ends_at: null },
  refunded: { starts_at: at(-3), ends_at: at(-1) },
};

const APPROVED_STATES: readonly State[] = ['scheduled', 'active', 'ended'];

/** One campaign as the server answers it. */
export function promotionJson(state: State, overrides: Json = {}): Json {
  return {
    id: PROMOTION_ID,
    category: 'special_offer',
    headline: 'Two bowls of pho for the price of one',
    preferred_start: null,
    state,
    ...WINDOWS[state],
    reject_reason: state === 'rejected' ? 'headline' : null,
    price_cents: 2500,
    currency_code: 'CAD',
    length_days: 7,
    // Spec 16 campaigns were approved by hand: free. A refunded one had been paid.
    paid: state === 'refunded',
    is_free: APPROVED_STATES.includes(state),
    created_at: at(-12),
    ...overrides,
  };
}

export function myPromotionJson(
  promotion: Json | null,
  { settings = SETTINGS_JSON as Json | null, eligible = true } = {},
): Json {
  return { promotion, settings, eligible };
}

export function pgError(message: string) {
  return { code: 'P0001', message, details: null, hint: null };
}

export const NETWORK_ERROR = {
  code: '',
  message: 'TypeError: Network request failed',
  details: 'TypeError: Network request failed',
  hint: '',
};

// -- The fake server -----------------------------------------------------------------------
type Row = {
  id: string;
  category: string;
  headline: string;
  preferred_start: string | null;
  status: 'requested' | 'payment_due' | 'approved' | 'rejected' | 'cancelled' | 'refunded';
  starts_at: string | null;
  ends_at: string | null;
  reject_reason: string | null;
  created_at: string;
  /** Spec 16b: payment_due rows only. */
  pay_by?: string | null;
  /** Spec 16b: defaults follow promotionJson (approved = free, refunded = paid). */
  paid?: boolean;
  is_free?: boolean;
};

export type FakeServer = {
  rpc: (name: string, args?: Json) => Promise<{ data: unknown; error: unknown }>;
  /** Stored rows, oldest first. */
  rows: Row[];
  settings: Json | null;
  eligible: boolean;
  signedIn: boolean;
  /** The next call fails like a lost connection. */
  failNext: () => void;
  /** What the admin runbook does, for walking the states. */
  approve: (id: string, startsAt: string) => void;
};

function derivedState(row: Row, now: Date): State {
  if (row.status === 'payment_due') {
    return now < new Date(row.pay_by as string) ? 'awaiting_payment' : 'payment_expired';
  }
  if (row.status !== 'approved') return row.status;
  if (now < new Date(row.starts_at as string)) return 'scheduled';
  if (now < new Date(row.ends_at as string)) return 'active';
  return 'ended';
}

export function createFakeServer({
  rows = [] as Row[],
  settings = SETTINGS_JSON as Json | null,
  eligible = true,
  now = NOW,
} = {}): FakeServer {
  let failing = false;
  let next = 0;

  const server: FakeServer = {
    rows: [...rows],
    settings,
    eligible,
    signedIn: true,
    failNext: () => {
      failing = true;
    },
    approve: (id, startsAt) => {
      const row = server.rows.find((r) => r.id === id);
      if (!row || row.status !== 'requested') throw new Error('invalid_transition');
      const length = Number((server.settings ?? SETTINGS_JSON).length_days);
      row.status = 'approved';
      row.is_free = true;
      row.starts_at = startsAt;
      row.ends_at = new Date(new Date(startsAt).getTime() + length * DAY_MS).toISOString();
    },
    rpc: async (name, args = {}) => {
      if (failing) {
        failing = false;
        return { data: null, error: NETWORK_ERROR };
      }
      try {
        return { data: call(name, args), error: null };
      } catch (error) {
        return { data: null, error: pgError((error as Error).message) };
      }
    },
  };

  function json(row: Row): Json {
    const s = (server.settings ?? SETTINGS_JSON) as typeof SETTINGS_JSON;
    return {
      id: row.id,
      category: row.category,
      headline: row.headline,
      preferred_start: row.preferred_start,
      state: derivedState(row, now),
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      reject_reason: row.reject_reason,
      price_cents: s.price_cents,
      currency_code: s.currency_code,
      length_days: s.length_days,
      paid: row.paid ?? row.status === 'refunded',
      is_free: row.is_free ?? row.status === 'approved',
      created_at: row.created_at,
    };
  }

  function mine(): Json {
    const latest = server.rows.at(-1);
    return myPromotionJson(latest ? json(latest) : null, {
      settings: server.settings,
      eligible: server.eligible,
    });
  }

  function call(name: string, args: Json): Json {
    if (name === 'get_my_promotion') return mine();
    if (name === 'request_promotion') {
      if (!server.signedIn) throw new Error('not_authenticated');
      if (!server.eligible) throw new Error('not_eligible');
      if (!server.settings) throw new Error('not_configured');
      const category = args.p_category as string | null;
      if (!category || !['new_dish', 'special_offer', 'featured'].includes(category)) {
        throw new Error('invalid_category');
      }
      // The server never trims: edge spaces are refused, like every other rule.
      const headline = args.p_headline as string | null;
      const check = headline === null ? null : checkHeadline(headline);
      if (!check?.ok || check.value !== headline) throw new Error('invalid_headline');
      const start = args.p_preferred_start as string | null;
      const today = now.toISOString().slice(0, 10);
      const offset = start === null ? 0 : (Date.parse(start) - Date.parse(today)) / DAY_MS;
      if (offset < -1 || offset > 90) throw new Error('invalid_start');
      if (
        server.rows.some((r) =>
          ['requested', 'awaiting_payment', 'scheduled', 'active'].includes(derivedState(r, now)),
        )
      ) {
        throw new Error('already_open');
      }
      const recent = server.rows.filter((r) => now.getTime() - Date.parse(r.created_at) < DAY_MS);
      if (recent.length >= 5) throw new Error('too_many_requests');
      next += 1;
      server.rows.push({
        id: `00000000-0000-4000-8000-${String(2000 + next).padStart(12, '0')}`,
        category,
        headline,
        preferred_start: start,
        status: 'requested',
        starts_at: null,
        ends_at: null,
        reject_reason: null,
        created_at: now.toISOString(),
      });
      return mine();
    }
    if (name === 'cancel_my_promotion') {
      const row = server.rows.find((r) => r.id === args.p_promotion_id);
      if (!row) throw new Error('not_found');
      const state = derivedState(row, now);
      // Spec 16b: a paid campaign is not cancelled from the app.
      if ((state === 'scheduled' || state === 'active') && !(row.is_free ?? true)) {
        throw new Error('contact_support');
      }
      if (!['requested', 'awaiting_payment', 'scheduled', 'active'].includes(state)) {
        throw new Error('not_cancellable');
      }
      row.status = 'cancelled';
      return mine();
    }
    throw new Error(`unexpected rpc ${name}`);
  }

  return server;
}

/** A stored row for the fake server, built from a derived state relative to NOW. */
export function storedRow(state: State, id = PROMOTION_ID, extra: Partial<Row> = {}): Row {
  const json = promotionJson(state, { id });
  const payBy = state === 'awaiting_payment' ? at(5) : state === 'payment_expired' ? at(-1) : null;
  return {
    id,
    category: json.category as string,
    headline: json.headline as string,
    preferred_start: null,
    status: APPROVED_STATES.includes(state)
      ? 'approved'
      : state === 'awaiting_payment' || state === 'payment_expired'
        ? 'payment_due'
        : (state as Row['status']),
    starts_at: json.starts_at as string | null,
    ends_at: json.ends_at as string | null,
    reject_reason: json.reject_reason as string | null,
    created_at: json.created_at as string,
    pay_by: payBy,
    ...extra,
  };
}
