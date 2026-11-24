import { z } from 'zod';

// The one call the database layer needs from supabase-js, so tests can check the exact function and
// argument names without a database.
export type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EventAnswer = z.object({
  outcome: z.enum(['applied', 'ignored', 'refund_requested', 'mismatch', 'duplicate']),
  refund: z.object({
    payment_id: z.string().regex(UUID),
    payment_intent_id: z.string().regex(/^pi_[A-Za-z0-9]+$/),
  }).optional(),
});
export type EventAnswer = z.infer<typeof EventAnswer>;

// Only a fixed code leaves this file: never the Postgres message, detail or hint (a unique
// violation's detail holds a full Stripe id; spec 16b review S7).
export class DatabaseError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DatabaseError';
  }
}

const KNOWN_ERRORS = ['invalid_event', 'invalid_event_data'];

function databaseError(error: unknown): DatabaseError {
  const message = (error as { message?: unknown } | null)?.message;
  return new DatabaseError(typeof message === 'string' && KNOWN_ERRORS.includes(message) ? message : 'database_error');
}

export function createDatabase(rpc: Rpc) {
  return {
    async recordEvent(eventId: string, type: string, livemode: boolean, data: Record<string, unknown>): Promise<EventAnswer> {
      const { data: answer, error } = await rpc('record_stripe_event', {
        p_event_id: eventId,
        p_type: type,
        p_livemode: livemode,
        p_data: data,
      });
      if (error) throw databaseError(error);
      const parsed = EventAnswer.safeParse(answer);
      if (!parsed.success) throw new DatabaseError('unexpected_answer');
      return parsed.data;
    },

    async markRefundRequested(paymentId: string): Promise<void> {
      const { error } = await rpc('mark_refund_requested', { p_payment_id: paymentId });
      if (error) throw databaseError(error);
    },
  };
}
