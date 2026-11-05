// Wires real dependencies into the pure handler. Tests use handler.ts with fakes instead.
// Called by pg_cron through pg_net (private.invoke_places_refresh), never by app users.
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createGoogleClient } from '../_shared/google.ts';
import { withLogging } from '../_shared/http.ts';
import { type ClaimedRow, createHandler, type Outcome } from './handler.ts';

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const url = requireEnv('SUPABASE_URL');
// Service role stays inside this function: claim and apply are not executable by app users.
const admin = createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const Claimed = z.array(z.object({ business_id: z.string(), place_id: z.string() }));

async function claimBatch(size: number): Promise<ClaimedRow[]> {
  const { data, error } = await admin.rpc('claim_places_refresh_batch', { p_batch: size });
  if (error) throw new Error('claim_places_refresh_batch failed');
  const rows = Claimed.safeParse(data);
  if (!rows.success) throw new Error('claim_places_refresh_batch returned an unexpected shape');
  return rows.data.map((row) => ({ businessId: row.business_id, placeId: row.place_id }));
}

async function applyOutcome(
  businessId: string,
  outcome: Outcome,
  location?: { latitude: number; longitude: number },
): Promise<void> {
  const { error } = await admin.rpc('apply_places_refresh', {
    p_business_id: businessId,
    p_outcome: outcome,
    p_lat: location?.latitude ?? null,
    p_lng: location?.longitude ?? null,
  });
  if (error) throw new Error('apply_places_refresh failed');
}

const apiKey = Deno.env.get('PLACES_API_KEY');

Deno.serve(
  withLogging(
    'places-refresh',
    createHandler({
      cronSecret: Deno.env.get('REFRESH_CRON_SECRET'),
      googleConfigured: Boolean(apiKey),
      claimBatch,
      applyOutcome,
      // 5 s per Google call (the client's default timeout).
      google: createGoogleClient({ apiKey, fetch }),
    }),
  ),
);
