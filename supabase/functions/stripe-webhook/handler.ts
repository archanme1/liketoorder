import { z } from 'zod';
import { type Handler, json, readRawBody } from '../_shared/http.ts';
import { type StripeClient, StripeError, verifyStripeSignature } from '../_shared/stripe.ts';
import { DatabaseError, type EventAnswer } from './rpc.ts';

// Stripe states no event size limit; other activity on the account must not fail forever (D0).
export const MAX_BODY_BYTES = 256 * 1024;
// paid_at must look like Unix seconds: after 2020-01-01 and at most 300 s ahead (a milliseconds
// value is far beyond that).
export const PAID_AT_FLOOR = 1577836800;
const PAID_AT_AHEAD = 300;

const KNOWN_TYPES = [
  'invoice.paid',
  'invoice.voided',
  'invoice.marked_uncollectible',
  'charge.refunded',
  'charge.dispute.created',
];
const INVOICE_ID = /^in_[A-Za-z0-9]+$/;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]+$/;

export type Deps = {
  webhookSecret: string | undefined; // STRIPE_WEBHOOK_SECRET
  expectLivemode: string | undefined; // STRIPE_EXPECT_LIVEMODE: exactly 'true' or 'false'
  stripe: StripeClient | undefined; // undefined when STRIPE_SECRET_KEY is not set
  db: {
    recordEvent(eventId: string, type: string, livemode: boolean, data: Record<string, unknown>): Promise<EventAnswer>;
    markRefundRequested(paymentId: string): Promise<void>;
  };
  now?: () => number; // milliseconds
};

const Envelope = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9]+$/),
  type: z.string().min(1).max(100),
  livemode: z.boolean(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const PaidInvoice = z.object({
  id: z.string().regex(INVOICE_ID),
  amount_paid: z.number().int().min(0),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  status_transitions: z.object({ paid_at: z.number().int() }),
});

const InvoicePayments = z.object({
  data: z.array(z.object({ payment: z.object({ payment_intent: z.unknown() }).partial().nullish() })),
});

// A failure Stripe should retry: answered with `status` and no body.
class Retry extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

// Logs carry the event type (known types only) and an outcome or error code: never an id, the body,
// the signature header, an email or a secret.
function log(line: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: 'stripe-webhook', ...line }));
}

function empty(status: number): Response {
  return new Response(null, { status });
}

function piOrNull(value: unknown): string | null {
  return typeof value === 'string' && PAYMENT_INTENT_ID.test(value) ? value : null;
}

function wholeOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

// The p_data contract of public.record_stripe_event (PR 1 migration).
async function eventData(
  type: string,
  object: Record<string, unknown>,
  stripe: StripeClient | undefined,
  nowSeconds: number,
): Promise<Record<string, unknown>> {
  switch (type) {
    case 'invoice.paid': {
      // Everything the database needs from the event is checked before any network or database call.
      const invoice = PaidInvoice.safeParse(object);
      if (!invoice.success) throw new Retry(500, 'invalid_paid_invoice');
      const paidAt = invoice.data.status_transitions.paid_at;
      if (paidAt <= PAID_AT_FLOOR || paidAt > nowSeconds + PAID_AT_AHEAD) throw new Retry(500, 'invalid_paid_at');
      if (!stripe) throw new Retry(503, 'payments_unavailable');

      // The invoice carries no PaymentIntent in the pinned API version: look up its paid payment.
      let paymentIntent: string | null;
      try {
        const answer = await stripe.get('/v1/invoice_payments', { invoice: invoice.data.id, status: 'paid' });
        const payments = InvoicePayments.parse(answer);
        paymentIntent = payments.data.map((p) => piOrNull(p.payment?.payment_intent)).find((v) => v !== null) ?? null;
      } catch {
        throw new Retry(500, 'lookup_failed');
      }
      // null (no paid payment, e.g. paid out of band): the database answers mismatch for an invoice
      // that is not ours and raises invalid_event_data for ours.
      return {
        invoice_id: invoice.data.id,
        payment_intent_id: paymentIntent,
        amount_paid: invoice.data.amount_paid,
        currency: invoice.data.currency,
        paid_at: paidAt,
      };
    }
    case 'invoice.voided':
    case 'invoice.marked_uncollectible': {
      const id = object.id;
      return typeof id === 'string' && INVOICE_ID.test(id) ? { invoice_id: id } : {};
    }
    case 'charge.refunded':
      return {
        payment_intent_id: piOrNull(object.payment_intent),
        amount_refunded: wholeOrNull(object.amount_refunded),
        refunded: typeof object.refunded === 'boolean' ? object.refunded : null,
      };
    case 'charge.dispute.created':
      return { payment_intent_id: piOrNull(object.payment_intent) };
    default:
      return {};
  }
}

// D5 / D12: one full refund per payment, by its PaymentIntent, with a fixed key. The payment stays
// needs_refund until Stripe accepted the call; a failure answers 500 so Stripe retries the event.
async function refund(deps: Deps, target: NonNullable<EventAnswer['refund']>): Promise<void> {
  if (!deps.stripe) throw new Retry(503, 'payments_unavailable');
  try {
    await deps.stripe.post(
      '/v1/refunds',
      { payment_intent: target.payment_intent_id, reason: 'duplicate' },
      `refund-${target.payment_id}`,
    );
  } catch (e) {
    // Already refunded (a retry after Stripe pruned the key): the refund is done.
    if (!(e instanceof StripeError && e.code === 'charge_already_refunded')) throw new Retry(500, 'refund_failed');
  }
  await deps.db.markRefundRequested(target.payment_id);
}

// POST from Stripe. 400 bad signature or event, 413 over 256 KB, 503 not set up, 500 retry; 200 for
// everything handled (applied, duplicate, ignored, mismatch, other mode). Responses carry no detail.
export function createHandler(deps: Deps): Handler {
  const now = deps.now ?? Date.now;
  return async (req) => {
    if (req.method !== 'POST') return empty(405);
    const live = deps.expectLivemode === 'true' ? true : deps.expectLivemode === 'false' ? false : null;
    if (!deps.webhookSecret || live === null) {
      await req.body?.cancel();
      log({ code: 'not_configured' });
      return empty(503);
    }

    // Signature first: no JSON parse, no database call and no Stripe call before it passes.
    const raw = await readRawBody(req, MAX_BODY_BYTES);
    if (raw === undefined) {
      log({ code: 'too_large' });
      return empty(413);
    }
    const nowSeconds = Math.floor(now() / 1000);
    if (!(await verifyStripeSignature(raw, req.headers.get('Stripe-Signature'), deps.webhookSecret, nowSeconds))) {
      log({ code: 'bad_signature' });
      return empty(400);
    }

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      body = undefined;
    }
    const event = Envelope.safeParse(body);
    if (!event.success) {
      log({ code: 'bad_event' });
      return empty(400);
    }
    const type = KNOWN_TYPES.includes(event.data.type) ? event.data.type : 'other';

    // D11 (a): a test event never reaches a live database and the other way round.
    if (event.data.livemode !== live) {
      log({ type, code: 'livemode_mismatch' });
      return json(200, { received: true });
    }

    try {
      const data = await eventData(event.data.type, event.data.data.object, deps.stripe, nowSeconds);
      const answer = await deps.db.recordEvent(event.data.id, event.data.type, event.data.livemode, data);
      if (answer.refund) await refund(deps, answer.refund);
      log({ type, outcome: answer.outcome, refunded: answer.refund !== undefined });
      return json(200, { received: true });
    } catch (e) {
      const status = e instanceof Retry ? e.status : 500;
      const code = e instanceof Retry || e instanceof DatabaseError ? e.code : 'internal_error';
      log({ type, code });
      return empty(status);
    }
  };
}
