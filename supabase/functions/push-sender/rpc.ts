import { z } from 'zod';
import type { Claim, ClaimedMessage, PushResult, ReceiptResult } from './handler.ts';

// The one call the database layer needs from supabase-js, so tests can check the exact function
// and argument names without a database.
export type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The same format push_tokens accepts.
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/;
const OutboxIds = z.array(z.number().int().positive()).min(1);

// Unknown keys are dropped by the parse, so nothing but these fields can reach a push.
const Message = z.object({
  outbox_ids: OutboxIds,
  event: z.enum(['new_request', 'cancelled', 'arrived', 'accepted', 'declined', 'expired']),
  kind: z.enum(['pickup', 'table']),
  request_id: z.string().regex(UUID),
  side: z.enum(['sent', 'received']),
  business_name: z.string().nullable(),
  count: z.number().int().min(1),
  tokens: z.array(z.object({ id: z.string().regex(UUID), token: z.string().regex(EXPO_TOKEN) })).min(1),
});
const Receipts = z.array(z.string());

export function createDatabase(rpc: Rpc) {
  return {
    async claimBatch(limit: number): Promise<Claim> {
      const { data, error } = await rpc('claim_push_batch', { p_limit: limit });
      if (error) throw new Error('claim_push_batch failed');
      if (!Array.isArray(data)) throw new Error('claim_push_batch returned an unexpected shape');
      const claim: Claim = { messages: [], invalid: [] };
      for (const item of data) {
        const m = Message.safeParse(item);
        if (m.success) {
          const message: ClaimedMessage = {
            outboxIds: m.data.outbox_ids,
            event: m.data.event,
            kind: m.data.kind,
            requestId: m.data.request_id,
            side: m.data.side,
            businessName: m.data.business_name,
            count: m.data.count,
            tokens: m.data.tokens,
          };
          claim.messages.push(message);
        } else {
          // Recorded as failed when its ids are readable; otherwise the row is claimed again later.
          const ids = OutboxIds.safeParse((item as { outbox_ids?: unknown } | null)?.outbox_ids);
          if (ids.success) claim.invalid.push(ids.data);
        }
      }
      return claim;
    },

    async recordResults(results: PushResult[]): Promise<void> {
      const { error } = await rpc('record_push_results', { p_results: results });
      if (error) throw new Error('record_push_results failed');
    },

    async claimReceipts(limit: number): Promise<string[]> {
      const { data, error } = await rpc('claim_push_receipts', { p_limit: limit });
      if (error) throw new Error('claim_push_receipts failed');
      const ids = Receipts.safeParse(data);
      if (!ids.success) throw new Error('claim_push_receipts returned an unexpected shape');
      return ids.data;
    },

    async recordReceipts(results: ReceiptResult[]): Promise<void> {
      const { error } = await rpc('record_push_receipts', { p_results: results });
      if (error) throw new Error('record_push_receipts failed');
    },
  };
}
