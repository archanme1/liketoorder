import { z } from 'zod';
import { type Handler, json, readJsonBody } from '../_shared/http.ts';
import { type StripeClient, StripeError, secretMatches } from '../_shared/stripe.ts';
import { type BeginAnswer, type Database, DatabaseError } from './rpc.ts';

// A shorter PROMOTION_ADMIN_SECRET counts as no secret (spec 16b, D0 answers).
export const MIN_ADMIN_SECRET_LENGTH = 32;

type Code =
  | 'invalid_input'
  | 'not_found'
  | 'not_payable'
  | 'payment_window_closed'
  | 'already_sent'
  | 'no_email'
  | 'rate_limited'
  | 'stripe_error'
  | 'not_configured'
  | 'payments_unavailable'
  | 'internal_error';

const STATUS: Record<Code, number> = {
  invalid_input: 400,
  not_found: 404,
  not_payable: 409,
  payment_window_closed: 409,
  already_sent: 409,
  no_email: 409,
  rate_limited: 429,
  stripe_error: 502,
  not_configured: 503,
  payments_unavailable: 503,
  internal_error: 500,
};

// Database codes the admin may see as they are; not_attachable means the promotion is no longer payable.
const DATABASE_CODES: Record<string, Code> = {
  not_found: 'not_found',
  not_payable: 'not_payable',
  payment_window_closed: 'payment_window_closed',
  not_configured: 'not_configured',
  rate_limited: 'rate_limited',
  not_attachable: 'not_payable',
  invalid_id: 'stripe_error',
};

export type Deps = {
  adminSecret: string | undefined; // PROMOTION_ADMIN_SECRET
  stripe: StripeClient | undefined; // undefined when STRIPE_SECRET_KEY is not set
  db: Database;
  // The owner's email from auth, read server side; null when the account has none.
  getOwnerEmail: (ownerId: string) => Promise<string | null>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invoice'), promotion_id: z.string().regex(UUID) }),
  z.object({ action: z.literal('void_pending') }),
]);

const Customer = z.object({ id: z.string().regex(/^cus_[A-Za-z0-9]+$/) });
const Invoice = z.object({
  id: z.string().regex(/^in_[A-Za-z0-9]+$/),
  status: z.string(),
  total: z.number().int(),
  livemode: z.boolean(),
});
type Invoice = z.infer<typeof Invoice>;

// A stop with a fixed answer code.
class Stop extends Error {
  constructor(readonly code: Code) {
    super(code);
  }
}

// Logs carry the action and an outcome or error code: never an id, an email, a name or a secret.
function log(line: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: 'promotion-invoice', ...line }));
}

function fail(code: Code): Response {
  return json(STATUS[code], { ok: false, error: code });
}

function codeOf(e: unknown): Code {
  if (e instanceof Stop) return e.code;
  if (e instanceof StripeError || e instanceof z.ZodError) return 'stripe_error';
  if (e instanceof DatabaseError) return DATABASE_CODES[e.code] ?? 'internal_error';
  return 'internal_error';
}

// The `invoice` command (spec 16b, Edge Functions): customer, invoice, attach, item, finalize, the
// pre-send check, send. Every POST has the key <step>-<payment id>. A resumed run reads the invoice's
// state at Stripe and continues from there, so nothing is posted twice after a key is pruned.
async function sendInvoice(deps: Deps, stripe: StripeClient, promotionId: string): Promise<Response> {
  const begin: BeginAnswer = await deps.db.begin(promotionId);
  if ('already_sent' in begin) return fail('already_sent');

  const email = await deps.getOwnerEmail(begin.owner_id);
  if (!email || !email.includes('@')) return fail('no_email');

  const paymentId = begin.payment_id;
  const description = `LikeToOrder promotion, ${begin.length_days} days`;
  const metadata = { payment_id: paymentId };
  const dueDate = Math.floor(Date.parse(begin.pay_by) / 1000);
  if (!Number.isSafeInteger(dueDate)) throw new Stop('internal_error');

  let customerId = begin.customer_id;
  let invoice: Invoice;
  if (begin.invoice_id === null) {
    customerId = Customer.parse(
      await stripe.post('/v1/customers', { email, name: begin.business_name, metadata }, `customer-${paymentId}`),
    ).id;
    invoice = Invoice.parse(
      await stripe.post('/v1/invoices', {
        customer: customerId,
        collection_method: 'send_invoice',
        due_date: dueDate,
        auto_advance: false,
        currency: 'cad',
        description,
        pending_invoice_items_behavior: 'exclude',
        metadata: { promotion_id: promotionId, payment_id: paymentId },
      }, `invoice-${paymentId}`),
    );
    try {
      await deps.db.attach(paymentId, customerId, invoice.id, invoice.livemode);
    } catch (e) {
      if (!(e instanceof DatabaseError && e.code === 'not_attachable')) throw e;
      // Cancelled or lapsed during the run: the draft is deleted (a draft cannot be voided) and
      // never finalized or sent. If the delete fails, the runbook's manual step covers it.
      try {
        await stripe.del(`/v1/invoices/${invoice.id}`);
      } catch {
        log({ action: 'invoice', code: 'draft_delete_failed' });
      }
      return fail('not_payable');
    }
  } else {
    invoice = Invoice.parse(await stripe.get(`/v1/invoices/${begin.invoice_id}`));
  }
  if (!customerId) throw new Stop('internal_error');

  if (invoice.status === 'draft' && invoice.total === 0) {
    await stripe.post('/v1/invoiceitems', {
      customer: customerId,
      invoice: invoice.id,
      amount: begin.amount_cents,
      currency: 'cad',
      description,
      metadata,
    }, `invoiceitem-${paymentId}`);
    invoice = { ...invoice, total: begin.amount_cents };
  }
  if (invoice.status === 'draft') {
    if (invoice.total !== begin.amount_cents) throw new Stop('stripe_error');
    invoice = Invoice.parse(await stripe.post(`/v1/invoices/${invoice.id}/finalize`, {}, `finalize-${paymentId}`));
  }
  if (invoice.status !== 'open') throw new Stop('stripe_error');

  // PR 1 review S3: a cancel or the end of the window during the run means no send.
  if (!(await deps.db.checkSendable(paymentId))) {
    try {
      await stripe.post(`/v1/invoices/${invoice.id}/void`, {}, `void-${paymentId}`);
      await deps.db.markVoid(paymentId);
    } catch {
      log({ action: 'invoice', code: 'void_failed' }); // listed again by void_pending
    }
    return fail('not_payable');
  }

  await stripe.post(`/v1/invoices/${invoice.id}/send`, {}, `send-${paymentId}`);
  await deps.db.markSent(paymentId);
  log({ action: 'invoice', outcome: 'sent' });
  return json(200, { ok: true, invoice_status: 'sent' });
}

// The `void_pending` command (D16): every listed invoice is tried, in order; a failure is counted and
// the loop goes on. Drafts are deleted, invoices already void are only marked, paid ones are left to
// the webhook.
async function voidPending(deps: Deps, stripe: StripeClient): Promise<Response> {
  const rows = await deps.db.listToVoid();
  let voided = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      try {
        await stripe.post(`/v1/invoices/${row.invoice_id}/void`, {}, `void-${row.payment_id}`);
      } catch (e) {
        if (!(e instanceof StripeError)) throw e;
        const current = Invoice.parse(await stripe.get(`/v1/invoices/${row.invoice_id}`));
        if (current.status === 'paid') {
          skipped++;
          continue;
        }
        if (current.status === 'draft') await stripe.del(`/v1/invoices/${row.invoice_id}`);
        else if (current.status !== 'void') throw e;
      }
      await deps.db.markVoid(row.payment_id);
      voided++;
    } catch (e) {
      failed++;
      log({ action: 'void_pending', code: codeOf(e) });
    }
  }
  log({ action: 'void_pending', voided, failed, skipped });
  return json(200, { ok: true, voided, failed, skipped });
}

// POST with header x-admin-secret and { action: 'invoice', promotion_id } or { action: 'void_pending' }.
// Admin only (D13); never called by the app. Answers carry only { ok, invoice_status } or a code.
export function createHandler(deps: Deps): Handler {
  return async (req) => {
    if (req.method !== 'POST') return new Response(null, { status: 405 });

    // Admin secret first: no body parse, no database call and no Stripe call before it passes.
    if (!deps.adminSecret || deps.adminSecret.length < MIN_ADMIN_SECRET_LENGTH) {
      await req.body?.cancel();
      log({ code: 'not_configured' });
      return fail('not_configured');
    }
    if (!(await secretMatches(req.headers.get('x-admin-secret'), deps.adminSecret))) {
      await req.body?.cancel();
      log({ code: 'unauthorized' });
      return new Response(null, { status: 401 });
    }

    const body = Body.safeParse(await readJsonBody(req));
    if (!body.success) return fail('invalid_input');
    if (!deps.stripe) {
      log({ action: body.data.action, code: 'payments_unavailable' });
      return fail('payments_unavailable');
    }

    try {
      return body.data.action === 'invoice'
        ? await sendInvoice(deps, deps.stripe, body.data.promotion_id)
        : await voidPending(deps, deps.stripe);
    } catch (e) {
      const code = codeOf(e);
      log({ action: body.data.action, code });
      return fail(code);
    }
  };
}
