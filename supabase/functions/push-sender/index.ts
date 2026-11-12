// Wires real dependencies into the pure handler. Tests use handler.ts with fakes instead.
// Called through pg_net by the request triggers (a kick) and by pg_cron every minute
// (private.invoke_push_sender), never by app users.
import { createClient } from '@supabase/supabase-js';
import { createExpoClient } from '../_shared/expoPush.ts';
import { withLogging } from '../_shared/http.ts';
import { createHandler } from './handler.ts';
import { createDatabase } from './rpc.ts';

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const url = requireEnv('SUPABASE_URL');
// Service role stays inside this function: the claim and record functions are not executable by app users.
const admin = createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const database = createDatabase((fn, args) => admin.rpc(fn, args));

Deno.serve(
  withLogging(
    'push-sender',
    createHandler({
      cronSecret: Deno.env.get('PUSH_SENDER_SECRET'),
      claimBatch: database.claimBatch,
      recordResults: database.recordResults,
      claimReceipts: database.claimReceipts,
      recordReceipts: database.recordReceipts,
      // EXPO_ACCESS_TOKEN is optional (Expo's enhanced push security). 10 s per request.
      expo: createExpoClient({ fetch, accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') || undefined }),
    }),
  ),
);
