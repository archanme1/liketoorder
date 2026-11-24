// Wires real dependencies into the pure handler. Tests use handler.ts with fakes instead.
// Called only by Archan with the admin secret (verify_jwt = false: the secret is the auth). Never
// called by the app.
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
    'promotion-invoice',
    createHandler({
      adminSecret: Deno.env.get('PROMOTION_ADMIN_SECRET'),
      stripe: stripeKey ? createStripeClient({ fetch, key: stripeKey }) : undefined,
      db: createDatabase((fn, args) => admin.rpc(fn, args)),
      // The email goes only to Stripe: never logged, returned or stored in our tables.
      getOwnerEmail: async (ownerId) => {
        const { data, error } = await admin.auth.admin.getUserById(ownerId);
        if (error) throw new Error('owner_lookup_failed');
        return data.user?.email || null;
      },
    }),
  ),
);
