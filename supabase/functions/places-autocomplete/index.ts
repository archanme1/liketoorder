// Wires real dependencies into the pure handler. Tests use handler.ts with fakes instead.
import { createClient } from '@supabase/supabase-js';
import { createGetUser } from '../_shared/auth.ts';
import { createGoogleClient } from '../_shared/google.ts';
import { withLogging } from '../_shared/http.ts';
import { createConsumeQuota } from '../_shared/rateLimit.ts';
import { createHandler } from './handler.ts';

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const url = requireEnv('SUPABASE_URL');
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(url, requireEnv('SUPABASE_ANON_KEY'), clientOptions);
const admin = createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), clientOptions);

Deno.serve(
  withLogging(
    'places-autocomplete',
    createHandler({
      getUser: createGetUser(anon),
      consumeQuota: createConsumeQuota(admin),
      // Optional at startup: a missing key gives 500 only when Google is actually called.
      google: createGoogleClient({ apiKey: Deno.env.get('PLACES_API_KEY'), fetch }),
    }),
  ),
);
