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
 * - Safe to re-run: it deletes and re-creates only the demo customers (seed-customer@example.com,
 *   seed-customer-sam@example.com, seed-customer-priya@example.com); their requests go with them.
 * - Also seeds a seller inbox (spec 10) for seed_rest_001 (seed-restaurant-001@example.com) and
 *   seed_cook_1 (seed-homemade-1@example.com): pending, accepted with a passed pickup time, and
 *   answered requests, from three customers. Add `--inbox-extra` (or `--inbox-extra N`, default
 *   60) to give seed_rest_001 that many older requests, to scroll its inbox past 50.
 * - Also seeds answered requests (spec 10b): a decline for each reason, accepted requests with a
 *   note, and seed_rest_001 (seed-restaurant-001@example.com) as a CUSTOMER with sent requests, so
 *   its Requests tab shows both Received and Sent. Those sent requests belong to a seller account the
 *   seed does not delete, so each run removes and re-creates them (password for every seed account
 *   is password123).
 * - Add `--extra` (or `--extra N`, default 120) to also create that many older requests, for testing
 *   the My requests list's infinite scroll: SEED_SERVICE_ROLE_KEY=<key> npx tsx scripts/seed/requests.ts --extra 120
 * - Times are relative to when you run it, so re-run it for fresh times (the "expires in about 2
 *   minutes" row, and the accepted request that is "30 minutes from now").
 * - Never run by CI.
 */
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '../../src/types/database';

import {
  needsAddressSnapshot,
  parseExtra,
  parseInboxExtra,
  planAnswerNotes,
  planExtraRequests,
  planInboxExtra,
  planRequests,
  planSellerInbox,
  SEED_CUSTOMERS,
  snapshotItems,
  type CustomerKey,
  type PlannedRequest,
} from './requestsData';
import { assertLocalUrl, isSeedEmail } from './safety';

type Db = SupabaseClient<Database>;
type Target = {
  business: { id: string; name: string; currency_code: string | null };
  menu: { id: string; name: string; price_minor: number | null }[];
  /** A cook's current address, copied onto accepted requests like respond_to_request does. */
  address: string | null;
};

const PASSWORD = 'password123';

function fail(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

async function removeCustomers(db: Db): Promise<void> {
  const emails = new Set(SEED_CUSTOMERS.map((customer) => customer.email));
  for (const email of emails) {
    if (!isSeedEmail(email)) throw new Error('Refusing to delete a non-seed account.');
  }
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    fail(error, 'list users');
    const users = data?.users ?? [];
    for (const user of users) {
      if (!user.email || !emails.has(user.email)) continue;
      const result = await db.auth.admin.deleteUser(user.id);
      fail(result.error, `delete ${user.email}`);
    }
    if (users.length < 200) return;
  }
}

/** The demo business owners that also send requests (planAnswerNotes), by username. */
function ownerCustomerNames(plans: readonly PlannedRequest[]): string[] {
  const names = new Set<string>();
  for (const plan of plans) if (plan.customerUsername) names.add(plan.customerUsername);
  for (const name of names) {
    if (!/^seed_(rest_\d{3}|cook_\d+)$/.test(name)) {
      throw new Error('Refusing to touch the requests of a non-seed account.');
    }
  }
  return [...names];
}

/** Finds those owners and deletes the requests they SENT, so a re-run does not pile them up. */
async function ownerCustomerIds(db: Db, names: readonly string[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const name of names) {
    const found = await db.from('profiles').select('id').eq('username', name).maybeSingle();
    fail(found.error, `find ${name}`);
    if (!found.data) {
      throw new Error(`No demo account "${name}". Run scripts/seed/restaurants.ts first.`);
    }
    const removed = await db.from('pickup_requests').delete().eq('customer_id', found.data.id);
    fail(removed.error, `remove the requests ${name} sent`);
    ids.set(name, found.data.id);
  }
  return ids;
}

async function createCustomers(db: Db): Promise<Record<CustomerKey, string>> {
  const ids = {} as Record<CustomerKey, string>;
  for (const customer of SEED_CUSTOMERS) {
    const { data, error } = await db.auth.admin.createUser({
      email: customer.email,
      password: PASSWORD,
      email_confirm: true,
    });
    fail(error, `create ${customer.email}`);
    const id = data?.user?.id;
    if (!id) throw new Error(`create ${customer.email}: no id returned`);
    const update = await db
      .from('profiles')
      .update({ username: customer.username, display_name: customer.displayName })
      .eq('id', id);
    fail(update.error, `profile of ${customer.email}`);
    ids[customer.key] = id;
  }
  return ids;
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
  await removeCustomers(db);
  const customerIds = await createCustomers(db);

  const now = new Date();
  const extra = parseExtra(process.argv.slice(2));
  const inboxExtra = parseInboxExtra(process.argv.slice(2));
  const plans = [
    ...planRequests(now),
    ...planSellerInbox(now),
    ...(inboxExtra ? planInboxExtra(now, inboxExtra) : []),
    ...(extra ? planExtraRequests(now, extra) : []),
    // After everything else, so the earlier rows (and what the tests look up first) are unchanged.
    ...planAnswerNotes(now),
  ];
  const ownerIds = await ownerCustomerIds(db, ownerCustomerNames(plans));
  const targets = new Map<string, Target>();
  try {
    const rows: Database['public']['Tables']['pickup_requests']['Insert'][] = [];
    for (const plan of plans) {
      const cacheKey = `${plan.target.kind}:${plan.target.ownerUsername}`;
      let target = targets.get(cacheKey);
      if (!target) {
        const business = await findBusiness(db, plan);
        const menu = await db
          .from('menu_items')
          .select('id, name, price_minor')
          .eq('business_id', business.id)
          .eq('is_available', true)
          .order('position');
        fail(menu.error, `menu of ${business.name}`);
        let address: string | null = null;
        if (plan.target.kind === 'homemade') {
          const location = await db
            .from('business_locations')
            .select('formatted_address')
            .eq('business_id', business.id)
            .maybeSingle();
          fail(location.error, `address of ${business.name}`);
          address = location.data?.formatted_address ?? null;
        }
        target = { business, menu: menu.data ?? [], address };
        targets.set(cacheKey, target);
      }
      const items = snapshotItems(target.menu, plan.itemCount);
      // A request needs items or text: a business with no menu gets a written order instead.
      const orderText = plan.orderText ?? (items ? null : 'Two of whatever is good today');
      rows.push({
        business_id: target.business.id,
        customer_id: plan.customerUsername
          ? (ownerIds.get(plan.customerUsername) as string)
          : customerIds[plan.customer ?? 'demo'],
        status: plan.status,
        pickup_at: plan.pickupAt.toISOString(),
        items: items as unknown as Json,
        order_text: orderText,
        note: plan.note,
        currency_code: target.business.currency_code,
        idempotency_key: randomUUID(),
        expires_at: plan.expiresAt.toISOString(),
        responded_at: plan.respondedAt ? plan.respondedAt.toISOString() : null,
        created_at: plan.createdAt.toISOString(),
        // The seller's answer (spec 10b), as respond_to_request writes it.
        decline_reason: plan.declineReason ?? null,
        response_note: plan.responseNote ?? null,
        // The snapshot respond_to_request writes at Accept; never for a restaurant.
        accepted_address: needsAddressSnapshot(plan, now) ? target.address : null,
      });
      if (!plan.key.startsWith('extra-') && !plan.key.startsWith('inbox-extra-')) {
        console.log(`  ${plan.status.padEnd(9)} ${target.business.name} (${plan.purpose})`);
      }
    }
    for (let from = 0; from < rows.length; from += 50) {
      const inserted = await db.from('pickup_requests').insert(rows.slice(from, from + 50));
      fail(inserted.error, `requests ${from + 1} to ${Math.min(from + 50, rows.length)}`);
    }
  } catch (error) {
    console.error('Seeding failed; removing the demo customers so a re-run starts clean.');
    await removeCustomers(db).catch(() => undefined);
    throw error;
  }

  console.log('');
  console.log(
    `Added ${plans.length} requests for ${SEED_CUSTOMERS.length} demo customers (password ${PASSWORD})` +
      (extra ? `, ${extra} of them extra for the customer list's pagination` : '') +
      (inboxExtra ? `, ${inboxExtra} of them extra for the seller inbox's pagination` : '') +
      '.',
  );
  console.log(`Customers: ${SEED_CUSTOMERS.map((c) => c.email).join(', ')}`);
  console.log('Seller inbox: seed-restaurant-001@example.com and seed-homemade-1@example.com.');
  console.log(
    'Both switches: seed-restaurant-001@example.com has Received (inbox) and Sent (as a customer).',
  );
  console.log('Times are relative to now: re-run this seed for fresh times.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seeding failed.');
  process.exit(1);
});
