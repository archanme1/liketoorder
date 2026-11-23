/**
 * LOCAL ONLY. Seeds one demo promotion (spec 16, 16b) in each of six states: active, scheduled,
 * ended and requested (all free, approved by hand), payment_due (headline approved, an open fake
 * invoice) and a paid, scheduled campaign (a paid fake invoice).
 *
 * The payment rows carry obvious fake Stripe ids (in_FakeSeed0001, cus_FakeSeed0001, ...). No Stripe
 * object exists for them and nothing here talks to Stripe.
 *
 *   SEED_SERVICE_ROLE_KEY=<local service key> npx tsx scripts/seed/promotions.ts
 *   SEED_SERVICE_ROLE_KEY=<local service key> npx tsx scripts/seed/promotions.ts --many
 *   SEED_SERVICE_ROLE_KEY=<local service key> npx tsx scripts/seed/promotions.ts --offers
 *
 * --many (spec 16 PR 3) seeds 13 campaigns running now instead (11 Oshawa restaurants and 2 Oshawa
 * home cooks), more than the map's display limit of 8 large promoted markers.
 *
 * --offers (spec 16 PR 4) seeds 22 campaigns running now instead: everything within "About 30 km"
 * of Oshawa except seed_rest_001, more than one Offers page of 20. Run restaurants.ts and
 * homemade.ts first.
 *
 * Run `npx supabase db reset` (seed.sql adds the placeholder price: CAD 25.00 for 7 days) and
 * scripts/seed/restaurants.ts FIRST: the campaigns go to the demo restaurants it creates.
 *
 * - Talks only to http://127.0.0.1 or http://localhost (anything else is refused).
 * - The key is read from the environment variable SEED_SERVICE_ROLE_KEY. It is never printed.
 * - Safe to re-run: it first deletes the payment rows, then the campaigns, of the demo businesses any
 *   mode uses only, after checking each one belongs to a seed account. So switching modes leaves
 *   nothing behind.
 * - Times are relative to when you run it, so re-run it for a fresh active window.
 * - Rows are written directly (the admin approval is a database-owner call, not an API one).
 * - Never run by CI.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/types/database';

import { parseSeedMode, planForMode, promotionSeedOwners } from './promotionsData';
import { assertLocalUrl, assertSeedOwner } from './safety';

type Db = SupabaseClient<Database>;

function fail(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** The demo business of a seed owner, after proving the account is a seed one. */
async function seedBusiness(db: Db, username: string): Promise<{ id: string; name: string }> {
  const profile = await db.from('profiles').select('id').eq('username', username).maybeSingle();
  fail(profile.error, `find ${username}`);
  if (!profile.data) {
    throw new Error(`No demo account "${username}". Run scripts/seed/restaurants.ts first.`);
  }
  const account = await db.auth.admin.getUserById(profile.data.id);
  fail(account.error, `find the account of ${username}`);
  assertSeedOwner(username, account.data.user?.email);

  const business = await db
    .from('businesses')
    .select('id, name')
    .eq('owner_id', profile.data.id)
    .maybeSingle();
  fail(business.error, `find the business of ${username}`);
  if (!business.data)
    throw new Error(`${username} has no business. Run scripts/seed/restaurants.ts first.`);
  return business.data;
}

async function main() {
  const url = assertLocalUrl(process.env.SEED_SUPABASE_URL ?? 'http://127.0.0.1:54321');
  const key = process.env.SEED_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SEED_SERVICE_ROLE_KEY is not set. Set it to the local service key (see the steps you were given); it is never printed.',
    );
  }
  const mode = parseSeedMode(process.argv.slice(2));
  const db: Db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const modeNote = {
    default: '',
    many: ' (--many: 13 active campaigns)',
    offers: ' (--offers: 22 active campaigns)',
  }[mode];
  console.log(`Seeding promotions at ${url}${modeNote}`);
  const settings = await db
    .from('promotion_settings')
    .select('price_cents, currency_code, length_days')
    .maybeSingle();
  fail(settings.error, 'read the promotion settings');
  if (!settings.data) {
    throw new Error('No promotion settings row. Run `npx supabase db reset` (seed.sql adds it).');
  }

  const now = new Date();
  const lengthDays = settings.data.length_days;
  for (const username of promotionSeedOwners(now, lengthDays)) {
    const business = await seedBusiness(db, username);
    const old = await db.from('promotions').select('id').eq('business_id', business.id);
    fail(old.error, `find the old campaigns of ${business.name}`);
    const oldIds = (old.data ?? []).map((row) => row.id);
    if (oldIds.length > 0) {
      // Payment rows first (they would also go by cascade; deleting them by name keeps it explicit).
      const payments = await db.from('promotion_payments').delete().in('promotion_id', oldIds);
      fail(payments.error, `remove the old payment rows of ${business.name}`);
    }
    const removed = await db.from('promotions').delete().eq('business_id', business.id);
    fail(removed.error, `remove the old campaigns of ${business.name}`);
  }

  const plans = planForMode(mode, now, lengthDays);
  for (const plan of plans) {
    const business = await seedBusiness(db, plan.ownerUsername);
    const inserted = await db
      .from('promotions')
      .insert({
        business_id: business.id,
        category: plan.category,
        headline: plan.headline,
        preferred_start: plan.preferredStart,
        status: plan.status,
        price_cents: settings.data.price_cents,
        currency_code: settings.data.currency_code,
        length_days: settings.data.length_days,
        starts_at: plan.startsAt,
        ends_at: plan.endsAt,
        is_free: plan.isFree,
        pay_by: plan.payBy,
        paid_at: plan.paidAt,
        reviewed_at: plan.status === 'requested' ? null : now.toISOString(),
      })
      .select('id')
      .single();
    fail(inserted.error, `add the ${plan.state} campaign of ${business.name}`);
    if (plan.payment && inserted.data) {
      const payment = await db.from('promotion_payments').insert({
        promotion_id: inserted.data.id,
        amount_cents: settings.data.price_cents,
        currency_code: settings.data.currency_code,
        status: plan.payment.status,
        customer_id: plan.payment.customerId,
        invoice_id: plan.payment.invoiceId,
        livemode: false,
        invoice_sent_at: now.toISOString(),
        payment_intent_id: plan.payment.paymentIntentId,
        paid_at: plan.paidAt,
      });
      fail(payment.error, `add the fake payment row of ${business.name}`);
    }
    console.log(
      `  ${plan.state.padEnd(14)} ${business.name} (${plan.ownerEmail}): "${plan.headline}"`,
    );
  }
  console.log('Sign in as any of these with password password123 to see the seller side.');
  console.log('Times are relative to now: re-run this seed for a fresh active window.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seeding failed.');
  process.exit(1);
});
