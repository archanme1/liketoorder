import { z } from 'zod';

// The one call the database layer needs from supabase-js, so tests can check the exact function and
// argument names without a database.
export type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/;
const INVOICE_ID = /^in_[A-Za-z0-9]+$/;

const Begin = z.union([
  z.object({ already_sent: z.literal(true), invoice_status: z.literal('sent') }),
  z.object({
    resume: z.boolean(),
    payment_id: z.string().regex(UUID),
    owner_id: z.string().regex(UUID),
    business_name: z.string().min(1).max(200),
    amount_cents: z.number().int().positive(),
    currency: z.literal('CAD'),
    length_days: z.number().int().positive(),
    pay_by: z.string(),
    customer_id: z.string().regex(CUSTOMER_ID).nullable(),
    invoice_id: z.string().regex(INVOICE_ID).nullable(),
  }),
]);
export type BeginAnswer = z.infer<typeof Begin>;

// Every listed row has an invoice id: promotion_payments_attached requires one outside 'reserved'.
const ToVoid = z.array(z.object({ payment_id: z.string().regex(UUID), invoice_id: z.string().regex(INVOICE_ID) }));
export type InvoiceToVoid = z.infer<typeof ToVoid>[number];

// Only a fixed code leaves this file: never the Postgres message, detail or hint (a unique
// violation's detail holds a full Stripe id; spec 16b review S7).
export class DatabaseError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DatabaseError';
  }
}

const KNOWN_ERRORS = [
  'not_found',
  'not_payable',
  'payment_window_closed',
  'not_configured',
  'rate_limited',
  'not_attachable',
  'invalid_id',
];

async function call(rpc: Rpc, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await rpc(fn, args);
  if (error) {
    const message = (error as { message?: unknown } | null)?.message;
    throw new DatabaseError(typeof message === 'string' && KNOWN_ERRORS.includes(message) ? message : 'database_error');
  }
  return data;
}

function parsed<T>(schema: z.ZodType<T>, data: unknown): T {
  const out = schema.safeParse(data);
  if (!out.success) throw new DatabaseError('unexpected_answer');
  return out.data;
}

export function createDatabase(rpc: Rpc) {
  return {
    async begin(promotionId: string): Promise<BeginAnswer> {
      return parsed(Begin, await call(rpc, 'begin_promotion_invoice', { p_promotion_id: promotionId }));
    },
    async attach(paymentId: string, customerId: string, invoiceId: string, livemode: boolean): Promise<void> {
      await call(rpc, 'attach_invoice', {
        p_payment_id: paymentId,
        p_customer_id: customerId,
        p_invoice_id: invoiceId,
        p_livemode: livemode,
      });
    },
    async checkSendable(paymentId: string): Promise<boolean> {
      return parsed(z.boolean(), await call(rpc, 'check_invoice_sendable', { p_payment_id: paymentId }));
    },
    async markSent(paymentId: string): Promise<void> {
      await call(rpc, 'mark_invoice_sent', { p_payment_id: paymentId });
    },
    async listToVoid(): Promise<InvoiceToVoid[]> {
      return parsed(ToVoid, await call(rpc, 'list_invoices_to_void', {}));
    },
    async markVoid(paymentId: string): Promise<void> {
      await call(rpc, 'mark_invoice_void', { p_payment_id: paymentId });
    },
  };
}

export type Database = ReturnType<typeof createDatabase>;
