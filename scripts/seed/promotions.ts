/**
 * LOCAL ONLY. Seeds one demo promotion (spec 16) in each of four states: active, scheduled, ended
 * and requested.
 *
 *   SEED_SERVICE_ROLE_KEY=<local service key> npx tsx scripts/seed/promotions.ts
 *   SEED_SERVICE_ROLE_KEY=<local service key> npx tsx scripts/seed/promotions.ts --many
 *
 * --many (spec 16 PR 3) seeds 13 campaigns running now instead (11 Oshawa restaurants and 2 Oshawa
 * home cooks), more than the map's display limit of 8 large promoted markers.
 *
 * Run `npx supabase db reset` (seed.sql adds the placeholder price: CAD 25.00 for 7 days) and
 * scripts/seed/restaurants.ts FIRST: the campaigns go to the demo restaurants it creates.
 *
 * - Talks only to http://127.0.0.1 or http://localhost (anything else is refused).
 * - The key is read from the environment variable SEED_SERVICE_ROLE_KEY. It is never printed.
 * - Safe to re-run: it first deletes the campaigns of the demo businesses either mode uses only,
 *   after checking each one belongs to a seed account. So switching modes leaves nothing behind.
 * - Times are relative to when you run it, so re-run it for a fresh active window.
 * - Rows are written directly (the admin approval is a database-owner call, not an API one).
 * - Never run by CI.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/types/database';

import {
  parseMany,
  planManyPromotions,
  planPromotions,
  promotionSeedOwners,
} from './promotionsData';
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
  const many = parseMany(process.argv.slice(2));
  const db: Db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Seeding promotions at ${url}${many ? ' (--many: 13 active campaigns)' : ''}`);
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
    const removed = await db.from('promotions').delete().eq('business_id', business.id);
    fail(removed.error, `remove the old campaigns of ${business.name}`);
  }

  const plans = many ? planManyPromotions(now, lengthDays) : planPromotions(now, lengthDays);
  for (const plan of plans) {
    const business = await seedBusiness(db, plan.ownerUsername);
    const inserted = await db.from('promotions').insert({
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
      reviewed_at: plan.status === 'approved' ? now.toISOString() : null,
    });
    fail(inserted.error, `add the ${plan.state} campaign of ${business.name}`);
    console.log(
      `  ${plan.state.padEnd(9)} ${business.name} (${plan.ownerEmail}): "${plan.headline}"`,
    );
  }
  console.log('Sign in as any of these with password password123 to see the seller side.');
  console.log('Times are relative to now: re-run this seed for a fresh active window.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seeding failed.');
  process.exit(1);
});
