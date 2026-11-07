/**
 * LOCAL ONLY. Seeds demo pickup requests for one demo customer, at every status.
 *
 *   SEED_SERVICE_ROLE_KEY=<local service key> npx tsx scripts/seed/requests.ts
 *
 * Run scripts/seed/restaurants.ts FIRST (it creates the restaurants and cooks these requests go
 * to, and it removes every seed-* account, including this customer, each time it runs).
 *
 * - Talks only to http://127.0.0.1 or http://localhost (anything else is refused).
 * - The key is read from the environment variable SEED_SERVICE_ROLE_KEY. It is never printed.
 * - Safe to re-run: it deletes and re-creates only seed-customer@example.com.
 * - Times are relative to when you run it, so re-run it for fresh times (the "expires in about 2
 *   minutes" row, and the accepted request that is "30 minutes from now").
 * - Never run by CI.
 */
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '../../src/types/database';

import {
  CUSTOMER_EMAIL,
  CUSTOMER_USERNAME,
  planRequests,
  snapshotItems,
  type PlannedRequest,
} from './requestsData';
import { assertLocalUrl, isSeedEmail } from './safety';

type Db = SupabaseClient<Database>;

const PASSWORD = 'password123';

function fail(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

async function removeCustomer(db: Db): Promise<void> {
  if (!isSeedEmail(CUSTOMER_EMAIL)) throw new Error('Refusing to delete a non-seed account.');
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    fail(error, 'list users');
    const users = data?.users ?? [];
    for (const user of users) {
      if (user.email !== CUSTOMER_EMAIL) continue;
      const result = await db.auth.admin.deleteUser(user.id);
      fail(result.error, 'delete the demo customer');
    }
    if (users.length < 200) return;
  }
}

async function createCustomer(db: Db): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    email: CUSTOMER_EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  fail(error, 'create the demo customer');
  const id = data?.user?.id;
  if (!id) throw new Error('create the demo customer: no id returned');
  const update = await db
    .from('profiles')
    .update({ username: CUSTOMER_USERNAME, display_name: 'Demo Customer' })
    .eq('id', id);
  fail(update.error, 'demo customer profile');
  return id;
}

async function findBusiness(db: Db, plan: PlannedRequest) {
  const owner = await db
    .from('profiles')
    .select('id')
    .eq('username', plan.target.ownerUsername)
    .maybeSingle();
  fail(owner.error, `find ${plan.target.ownerUsername}`);
  if (!owner.data) {
    throw new Error(
      `No demo account "${plan.target.ownerUsername}". Run scripts/seed/restaurants.ts first.`,
    );
  }
  const business = await db
    .from('businesses')
    .select('id, name, type, currency_code')
    .eq('owner_id', owner.data.id)
    .eq('type', plan.target.kind)
    .maybeSingle();
  fail(business.error, `find the business of ${plan.target.ownerUsername}`);
  if (!business.data) {
    throw new Error(`"${plan.target.ownerUsername}" has no ${plan.target.kind} business.`);
  }
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
  const db: Db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Seeding pickup requests at ${url}`);
  await removeCustomer(db);
  const customerId = await createCustomer(db);

  const plans = planRequests(new Date());
  try {
    for (const plan of plans) {
      const business = await findBusiness(db, plan);
      const menu = await db
        .from('menu_items')
        .select('id, name, price_minor')
        .eq('business_id', business.id)
        .eq('is_available', true)
        .order('position');
      fail(menu.error, `menu of ${business.name}`);
      const items = snapshotItems(menu.data ?? [], plan.itemCount);
      // A request needs items or text: a business with no menu gets a written order instead.
      const orderText = plan.orderText ?? (items ? null : 'Two of whatever is good today');

      const inserted = await db.from('pickup_requests').insert({
        business_id: business.id,
        customer_id: customerId,
        status: plan.status,
        pickup_at: plan.pickupAt.toISOString(),
        items: items as unknown as Json,
        order_text: orderText,
        note: plan.note,
        currency_code: business.currency_code,
        idempotency_key: randomUUID(),
        expires_at: plan.expiresAt.toISOString(),
        responded_at: plan.respondedAt ? plan.respondedAt.toISOString() : null,
        created_at: plan.createdAt.toISOString(),
      });
      fail(inserted.error, `request "${plan.key}"`);
      console.log(`  ${plan.status.padEnd(9)} ${business.name} (${plan.purpose})`);
    }
  } catch (error) {
    console.error('Seeding failed; removing the demo customer so a re-run starts clean.');
    await removeCustomer(db).catch(() => undefined);
    throw error;
  }

  console.log('');
  console.log(`Added ${plans.length} requests for ${CUSTOMER_EMAIL} (password ${PASSWORD}).`);
  console.log('Times are relative to now: re-run this seed for fresh times.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seeding failed.');
  process.exit(1);
});
