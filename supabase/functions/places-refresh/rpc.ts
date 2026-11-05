import { z } from 'zod';
import type { PlaceLocation } from '../_shared/google.ts';
import type { ClaimedRow, Outcome } from './handler.ts';

// The one call the database layer needs from supabase-js, so tests can check the exact function
// and argument names without a database.
export type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

const Claimed = z.array(z.object({ business_id: z.string(), place_id: z.string() }));

export function createDatabase(rpc: Rpc) {
  return {
    async claimBatch(size: number): Promise<ClaimedRow[]> {
      const { data, error } = await rpc('claim_places_refresh_batch', { p_batch: size });
      if (error) throw new Error('claim_places_refresh_batch failed');
      const rows = Claimed.safeParse(data);
      if (!rows.success) throw new Error('claim_places_refresh_batch returned an unexpected shape');
      return rows.data.map((row) => ({ businessId: row.business_id, placeId: row.place_id }));
    },

    async applyOutcome(businessId: string, outcome: Outcome, location?: PlaceLocation): Promise<void> {
      const { error } = await rpc('apply_places_refresh', {
        p_business_id: businessId,
        p_outcome: outcome,
        p_lat: location?.latitude ?? null,
        p_lng: location?.longitude ?? null,
      });
      if (error) throw new Error('apply_places_refresh failed');
    },
  };
}
