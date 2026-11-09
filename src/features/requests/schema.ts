import { z } from 'zod';

// Limits mirror submit_pickup_request. The server is the judge; these give fast feedback only.
export const MAX_ORDER_TEXT = 500;
export const MAX_NOTE = 300;
export const MAX_LINES = 30;
/** Rows per page of list_my_pickup_requests (the server's limit). A full page may have a next. */
export const PAGE_SIZE = 50;
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 20;
export const MIN_LEAD_MINUTES = 15;
export const MAX_LEAD_DAYS = 7;

export const REQUEST_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'expired',
  'cancelled',
  'completed',
  'no_show',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'bad timestamp');

// What the server wrote into `items` at submit: name and price are its own copies.
export const requestItemSchema = z.strictObject({
  item_id: z.string().min(1),
  name: z.string(),
  unit_price_minor: z.number().int().nullable(),
  quantity: z.number().int().min(MIN_QUANTITY).max(MAX_QUANTITY),
});

// Strict on purpose: an unexpected field (place_id, coordinates, an address) means the server
// contract changed, and the app refuses it rather than carry private data around.
export const pickupRequestSchema = z.strictObject({
  id: z.string().min(1),
  business_id: z.string().min(1),
  business_name: z.string(),
  business_type: z.enum(['restaurant', 'homemade']),
  status: z.enum(REQUEST_STATUSES),
  display_status: z.enum(REQUEST_STATUSES),
  pickup_at: timestamp,
  items: z.array(requestItemSchema).nullable(),
  order_text: z.string().nullable(),
  note: z.string().nullable(),
  currency_code: z.string().nullable(),
  expires_at: timestamp,
  created_at: timestamp,
});

export const requestListSchema = z.strictObject({
  server_now: timestamp,
  requests: z.array(pickupRequestSchema),
});

export const requestDetailSchema = z.strictObject({
  server_now: timestamp,
  request: pickupRequestSchema.nullable(),
});

export const pickupAddressSchema = z.strictObject({ formatted_address: z.string().min(1) });

// The seller's view of a request (spec 10): the customer object plus the customer's display name
// and when it was answered. Still strict: no customer id or email, no address, no place_id.
export const sellerRequestSchema = pickupRequestSchema.extend({
  customer_name: z.string().nullable(),
  responded_at: timestamp.nullable(),
});

// next_cursor is the server's own text ("<created_at, microseconds>|<id>"), sent back untouched;
// null on the last page.
export const sellerRequestListSchema = z.strictObject({
  server_now: timestamp,
  requests: z.array(sellerRequestSchema),
  next_cursor: z.string().min(1).nullable(),
});

export const sellerRequestDetailSchema = z.strictObject({
  server_now: timestamp,
  request: sellerRequestSchema.nullable(),
});

export const waitingCountSchema = z.strictObject({
  server_now: timestamp,
  waiting: z.number().int().min(0),
});

/** The inbox filter: pending requests that can still be answered, or every request. */
export type InboxFilter = 'waiting' | 'all';
export type SellerDecision = 'accepted' | 'declined';
export type SellerOutcome = 'completed' | 'no_show';

export type PickupRequest = z.output<typeof pickupRequestSchema>;
export type SellerRequest = z.output<typeof sellerRequestSchema>;
export type SellerRequestList = z.output<typeof sellerRequestListSchema>;
export type SellerRequestDetail = z.output<typeof sellerRequestDetailSchema>;
export type WaitingCount = z.output<typeof waitingCountSchema>;
export type RequestItem = z.output<typeof requestItemSchema>;
export type RequestList = z.output<typeof requestListSchema>;
export type RequestDetail = z.output<typeof requestDetailSchema>;
export type PickupAddress = z.output<typeof pickupAddressSchema>;

// ── Free text ────────────────────────────────────────────────────────────────────────────────
// The database refuses these characters (function and table check). The app strips them first:
// ASCII controls except newline, DEL, C1 controls, zero-width characters (so a ZWJ emoji loses its
// joiner) and bidi overrides/isolates.
// Built from a string so the invisible characters stay readable as escapes in the source.
const HIDDEN_RANGES = [
  '\\u0000-\\u0009', // ASCII controls except newline (U+000A)
  '\\u000B-\\u001F',
  '\\u007F', // DEL
  '\\u0080-\\u009F', // C1 controls
  '\\u200B-\\u200D', // zero-width space, non-joiner, joiner
  '\\uFEFF', // zero-width no-break space (BOM)
  '\\u202A-\\u202E', // bidi embeddings and overrides
  '\\u2066-\\u2069', // bidi isolates
];
const HIDDEN = new RegExp(`[${HIDDEN_RANGES.join('')}]`, 'g');

export function stripHidden(text: string): string {
  return text.replace(HIDDEN, '');
}

/** Stripped and trimmed; empty text becomes undefined (the server stores null, not ""). */
export function cleanText(text: string | undefined): string | undefined {
  const cleaned = stripHidden(text ?? '').trim();
  return cleaned === '' ? undefined : cleaned;
}

// ── Order lines ──────────────────────────────────────────────────────────────────────────────
export type OrderLine = { itemId: string; quantity: number };

/**
 * One line per item, quantities summed (the server refuses the same item twice as invalid_items;
 * ids are compared case-insensitively like uuids). Lines with quantity 0 or less are dropped.
 */
export function mergeLines(lines: readonly OrderLine[]): OrderLine[] {
  const merged = new Map<string, OrderLine>();
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const key = line.itemId.toLowerCase();
    const existing = merged.get(key);
    if (existing) existing.quantity += line.quantity;
    else merged.set(key, { itemId: line.itemId, quantity: line.quantity });
  }
  return [...merged.values()];
}

// ── Pickup time ──────────────────────────────────────────────────────────────────────────────
const MINUTE = 60_000;

export type PickupTimeProblem = 'too_soon' | 'too_far';

/** The server's rule: at least 15 minutes ahead and at most 7 days. Null when fine. */
export function pickupTimeProblem(pickupAt: Date, now: Date): PickupTimeProblem | null {
  const ahead = pickupAt.getTime() - now.getTime();
  if (ahead < MIN_LEAD_MINUTES * MINUTE) return 'too_soon';
  if (ahead > MAX_LEAD_DAYS * 24 * 60 * MINUTE) return 'too_far';
  return null;
}

// ── The form ─────────────────────────────────────────────────────────────────────────────────
export type OrderDraft = {
  lines: readonly OrderLine[];
  orderText?: string;
  note?: string;
};

export type OrderDraftProblem =
  'empty_order' | 'too_many_lines' | 'text_too_long' | 'note_too_long';

export type SubmitArgs = {
  items: OrderLine[] | undefined;
  orderText: string | undefined;
  note: string | undefined;
};

/** Cleans and checks a draft with the server's limits. Returns the args to send, or a problem. */
export function prepareOrder(
  draft: OrderDraft,
): { ok: true; args: SubmitArgs } | { ok: false; problem: OrderDraftProblem } {
  const lines = mergeLines(draft.lines).map((line) => ({
    ...line,
    quantity: Math.min(line.quantity, MAX_QUANTITY),
  }));
  const orderText = cleanText(draft.orderText);
  const note = cleanText(draft.note);
  if (lines.length === 0 && orderText === undefined) return { ok: false, problem: 'empty_order' };
  if (lines.length > MAX_LINES) return { ok: false, problem: 'too_many_lines' };
  if (orderText !== undefined && orderText.length > MAX_ORDER_TEXT) {
    return { ok: false, problem: 'text_too_long' };
  }
  if (note !== undefined && note.length > MAX_NOTE) return { ok: false, problem: 'note_too_long' };
  return { ok: true, args: { items: lines.length > 0 ? lines : undefined, orderText, note } };
}
