// Wires real dependencies into the pure handler. Tests use handler.ts with fakes instead.
// Called by pg_cron through pg_net (private.invoke_places_refresh), never by app users.
import { createClient } from '@supabase/supabase-js';
import { createGoogleClient } from '../_shared/google.ts';
import { withLogging } from '../_shared/http.ts';
import { createHandler } from './handler.ts';
import { createDatabase } from './rpc.ts';

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

const database = createDatabase((fn, args) => admin.rpc(fn, args));

const apiKey = Deno.env.get('PLACES_API_KEY');

Deno.serve(
  withLogging(
    'places-refresh',
    createHandler({
      cronSecret: Deno.env.get('REFRESH_CRON_SECRET'),
      googleConfigured: Boolean(apiKey),
      claimBatch: database.claimBatch,
      applyOutcome: database.applyOutcome,
      // 5 s per Google call (the client's default timeout).
      google: createGoogleClient({ apiKey, fetch }),
    }),
  ),
);
