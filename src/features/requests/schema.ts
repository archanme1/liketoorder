import { z } from 'zod';

// Limits mirror submit_pickup_request. The server is the judge; these give fast feedback only.
export const MAX_ORDER_TEXT = 500;
export const MAX_NOTE = 300;
/** The seller's accept note and the written reason for "Other" (the table check allows 1 to 200). */
export const MAX_ANSWER_NOTE = 200;
export const MAX_LINES = 30;
/** Rows per page of the request lists (the server's limit); the server says whether a next page exists. */
export const PAGE_SIZE = 50;
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 20;
export const MIN_LEAD_MINUTES = 15;
export const MAX_LEAD_DAYS = 7;
// Table requests (spec 11): a party of 1 to 20, a table time from 30 minutes to 30 days ahead.
export const MIN_PARTY_SIZE = 1;
export const MAX_PARTY_SIZE = 20;
export const MIN_TABLE_LEAD_MINUTES = 30;
export const MAX_TABLE_LEAD_DAYS = 30;

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

export const DECLINE_REASONS = [
  'sold_out',
  'closed_then',
  'too_busy',
  'cannot_prepare',
  'time_not_possible',
  'other',
] as const;
export const declineReasonSchema = z.enum(DECLINE_REASONS);
export type DeclineReason = z.output<typeof declineReasonSchema>;

// A restaurant declining a table has its own list (spec 11). "other" is the only one with text.
export const TABLE_DECLINE_REASONS = [
  'fully_booked',
  'closed_then',
  'too_busy',
  'time_not_possible',
  'other',
] as const;
export const tableDeclineReasonSchema = z.enum(TABLE_DECLINE_REASONS);
export type TableDeclineReason = z.output<typeof tableDeclineReasonSchema>;

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
  // Which kind of request this is (spec 11). Always present on every request object.
  kind: z.literal('pickup'),
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
  // The seller's answer (spec 10b), always present and null when not set. The reason is only on a
  // declined row (a request declined before spec 10b has none); for "other" the seller's own words
  // are in response_note, and a fixed reason never carries a note.
  decline_reason: declineReasonSchema.nullable(),
  response_note: z.string().max(MAX_ANSWER_NOTE).nullable(),
});

// The customer's table request (15 keys). Strict like the pickup one: no customer id, no place_id,
// no address, no coordinates.
export const tableRequestSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.literal('table'),
  business_id: z.string().min(1),
  business_name: z.string(),
  business_type: z.enum(['restaurant', 'homemade']),
  status: z.enum(REQUEST_STATUSES),
  display_status: z.enum(REQUEST_STATUSES),
  table_at: timestamp,
  party_size: z.number().int().min(MIN_PARTY_SIZE).max(MAX_PARTY_SIZE),
  note: z.string().nullable(),
  expires_at: timestamp,
  created_at: timestamp,
  decline_reason: tableDeclineReasonSchema.nullable(),
  response_note: z.string().max(MAX_ANSWER_NOTE).nullable(),
  // Set once, by the server, when the customer taps "I've arrived".
  arrived_at: timestamp.nullable(),
});

/** A request in the customer's lists and detail: one kind or the other, told apart by `kind`. */
export const customerRequestSchema = z.discriminatedUnion('kind', [
  pickupRequestSchema,
  tableRequestSchema,
]);

// next_cursor is the server's own text ("<created_at, microseconds>|<id>"), sent back untouched;
// null on the last page.
export const requestListSchema = z.strictObject({
  server_now: timestamp,
  requests: z.array(customerRequestSchema),
  next_cursor: z.string().min(1).nullable(),
});

export const requestDetailSchema = z.strictObject({
  server_now: timestamp,
  request: customerRequestSchema.nullable(),
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
/** What a seller may attach to an answer. Both are optional here; the server judges them. */
export type RespondOptions = { declineReason?: DeclineReason; note?: string };

export type PickupRequest = z.output<typeof pickupRequestSchema>;
export type TableRequest = z.output<typeof tableRequestSchema>;
export type CustomerRequest = z.output<typeof customerRequestSchema>;
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

// ── The seller's answer ──────────────────────────────────────────────────────────────────────
// The form behind the Accept and Decline dialogs. Fast feedback only: respond_to_request judges.
const answerText = z.string().transform((text) => cleanText(text) ?? '');

export const respondInputSchema = z
  .discriminatedUnion('decision', [
    z.object({
      decision: z.literal('accepted'),
      note: answerText.pipe(z.string().max(MAX_ANSWER_NOTE)),
    }),
    z.object({
      decision: z.literal('declined'),
      reason: declineReasonSchema,
      // Only "other" has text; for a fixed reason it is dropped (the server refuses a note on one).
      text: answerText.pipe(z.string().max(MAX_ANSWER_NOTE)),
    }),
  ])
  .superRefine((value, ctx) => {
    if (value.decision === 'declined' && value.reason === 'other' && value.text === '') {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'required' });
    }
  });
export type RespondInput = z.input<typeof respondInputSchema>;

/** What to send for a valid answer form: nothing for an empty note, the text only for "other". */
export function respondOptions(
  input: z.output<typeof respondInputSchema>,
): RespondOptions | undefined {
  if (input.decision === 'accepted') return input.note === '' ? undefined : { note: input.note };
  return input.reason === 'other'
    ? { declineReason: 'other', note: input.text }
    : { declineReason: input.reason };
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

// -- Table time and the table form -------------------------------------------------------------
export type TableTimeProblem = 'too_soon' | 'too_far';

/** The server's rule: at least 30 minutes ahead and at most 30 days. Null when fine. */
export function tableTimeProblem(tableAt: Date, now: Date): TableTimeProblem | null {
  const ahead = tableAt.getTime() - now.getTime();
  if (ahead < MIN_TABLE_LEAD_MINUTES * MINUTE) return 'too_soon';
  if (ahead > MAX_TABLE_LEAD_DAYS * 24 * 60 * MINUTE) return 'too_far';
  return null;
}

// The table form's fields (react-hook-form + zod). Fast feedback only: submit_table_request judges.
// The time is checked against the clock when Send is pressed (tableTimeProblem), not here.
export const tableFormSchema = z.object({
  tableAt: z.date({ error: 'Choose a table time' }),
  partySize: z
    .number()
    .int()
    .min(MIN_PARTY_SIZE, 'Choose at least 1 person')
    .max(MAX_PARTY_SIZE, `Choose at most ${MAX_PARTY_SIZE} people`),
  note: z
    .string()
    .transform((text) => cleanText(text) ?? '')
    .pipe(z.string().max(MAX_NOTE, `Keep your note to ${MAX_NOTE} characters.`)),
});
export type TableFormInput = z.input<typeof tableFormSchema>;
export type TableFormValues = z.output<typeof tableFormSchema>;

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
