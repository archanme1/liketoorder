/**
 * LOCAL ONLY. Seeds food log uploads for the activity grid (spec 14).
 *
 *   SEED_SERVICE_ROLE_KEY=<local service key> npx tsx scripts/seed/foodLogs.ts [--tz <IANA name>]
 *
 * If you also run scripts/seed/restaurants.ts, run it FIRST: it removes every seed-* account,
 * including the two below, each time it runs.
 *
 * - Talks only to http://127.0.0.1 or http://localhost (anything else is refused).
 * - The key is read from the environment variable SEED_SERVICE_ROLE_KEY. It is never printed.
 * - Safe to re-run: it deletes and re-creates only seed-foodlog@example.com (seed_foodlog, about 6
 *   months of uneven uploads: streaks, gaps, busy days, mixed cuisines, some private, and a run
 *   ending yesterday) and seed-foodlog-empty@example.com (seed_foodlog_empty, no uploads, for the
 *   empty state). The password for both is password123.
 * - Every local_date is this Mac's local day (or the --tz zone's) at the planned time. Change the
 *   Mac's zone and relaunch the app to see "today" move while the uploads keep their days.
 * - The rows are ready with no stored file, so the thumbnails show the placeholder.
 * - At most 6 uploads on any date (the service role is not held to the app's daily cap).
 * - Never run by CI.
 */
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/types/database';

import {
  FOOD_LOG_ACCOUNTS,
  FOOD_LOG_PASSWORD,
  parseTimeZone,
  planFoodLogs,
  type FoodLogSeedAccount,
} from './foodLogsData';
import { assertLocalUrl, isSeedEmail } from './safety';

type Db = SupabaseClient<Database>;

function fail(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

async function removeAccounts(db: Db): Promise<void> {
  const emails = new Set(FOOD_LOG_ACCOUNTS.map((account) => account.email));
  for (const email of emails) {
    if (!isSeedEmail(email)) throw new Error('Refusing to delete a non-seed account.');
  }
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    fail(error, 'list users');
    const users = data?.users ?? [];
    for (const user of users) {
      if (!user.email || !emails.has(user.email) || !isSeedEmail(user.email)) continue;
      // Their food_logs go with them (on delete cascade).
      const result = await db.auth.admin.deleteUser(user.id);
      fail(result.error, `delete ${user.email}`);
    }
    if (users.length < 200) return;
  }
}

async function createAccount(db: Db, account: FoodLogSeedAccount): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    email: account.email,
    password: FOOD_LOG_PASSWORD,
    email_confirm: true,
  });
  fail(error, `create ${account.email}`);
  const id = data?.user?.id;
  if (!id) throw new Error(`create ${account.email}: no id returned`);
  const update = await db
    .from('profiles')
    .update({ username: account.username, display_name: account.displayName })
    .eq('id', id);
  fail(update.error, `profile of ${account.email}`);
  return id;
}

async function main() {
  const url = assertLocalUrl(process.env.SEED_SUPABASE_URL ?? 'http://127.0.0.1:54321');
  const key = process.env.SEED_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SEED_SERVICE_ROLE_KEY is not set. Set it to the local service key (see the steps you were given); it is never printed.',
    );
  }
  const timeZone = parseTimeZone(
    process.argv.slice(2),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const db: Db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Seeding food log uploads at ${url} in ${timeZone}`);
  await removeAccounts(db);

  const now = new Date();
  for (const account of FOOD_LOG_ACCOUNTS) {
    const authorId = await createAccount(db, account);
    if (!account.withLogs) {
      console.log(`${account.email}: no uploads (the empty state)`);
      continue;
    }
    const rows = planFoodLogs(now, timeZone).map((plan) => {
      // The path must be <author>/<id>.jpg (food_logs_path_shape), so the id is made here.
      const id = randomUUID();
      return {
        id,
        author_id: authorId,
        cuisine_code: plan.cuisineCode,
        description: plan.description,
        is_public: plan.isPublic,
        local_date: plan.localDate,
        path: `${authorId}/${id}.jpg`,
        status: 'ready',
        created_at: plan.createdAt,
        updated_at: plan.createdAt,
      };
    });
    for (let from = 0; from < rows.length; from += 50) {
      const inserted = await db.from('food_logs').insert(rows.slice(from, from + 50));
      fail(inserted.error, `insert food logs for ${account.email}`);
    }
    const dates = new Set(rows.map((row) => row.local_date)).size;
    console.log(`${account.email}: ${rows.length} uploads on ${dates} days`);
  }
  console.log('Sign in with password123. Thumbnails show the placeholder (no stored files).');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seeding failed.');
  process.exit(1);
});
