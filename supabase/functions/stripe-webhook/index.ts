// Wires real dependencies into the pure handler. Tests use handler.ts with fakes instead.
// Called only by Stripe (verify_jwt = false: the signature is the auth). Never called by the app.
import { createClient } from '@supabase/supabase-js';
import { withLogging } from '../_shared/http.ts';
import { createStripeClient } from '../_shared/stripe.ts';
import { createHandler } from './handler.ts';
import { createDatabase } from './rpc.ts';

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Service role stays inside this function: the payment functions are granted to service_role only.
const admin = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');

Deno.serve(
  withLogging(
    'stripe-webhook',
    createHandler({
      webhookSecret: Deno.env.get('STRIPE_WEBHOOK_SECRET') || undefined,
      expectLivemode: Deno.env.get('STRIPE_EXPECT_LIVEMODE'),
      stripe: stripeKey ? createStripeClient({ fetch, key: stripeKey }) : undefined,
      db: createDatabase((fn, args) => admin.rpc(fn, args)),
    }),
  ),
);
