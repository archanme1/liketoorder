/**
 * LOCAL ONLY. Seeds demo restaurants AND home cooks so both maps have pins.
 *
 *   SEED_SERVICE_ROLE_KEY=<local service key> npx tsx scripts/seed/restaurants.ts
 *
 * - Talks only to http://127.0.0.1 or http://localhost (anything else is refused).
 * - The key is read from the environment variable SEED_SERVICE_ROLE_KEY. It is never printed.
 * - Safe to re-run: it deletes and re-creates only the accounts named seed-*@example.com.
 * - Place IDs are fake (FAKE_PLACE_…): Directions will not open a real place for them.
 * - Home cooks go through the real set_business_location function, so their public map point is
 *   the real 200–500 m shift. (Photos for cooks are added in a later step.)
 * - Never run by CI.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/types/database';

import { HOMEMADE_COOKS, HOMEMADE_HIDDEN } from './homemadeData';
import {
  AREAS,
  HIDDEN,
  MENUS,
  RESTAURANTS,
  STREETS,
  type MenuLine,
  type Seed,
} from './restaurantData';
import { assertLocalUrl, isSeedEmail } from './safety';

type Db = SupabaseClient<Database>;

const PASSWORD = 'password123';
const DAY_MS = 24 * 60 * 60 * 1000;

// A small, fixed random generator so every run produces the same demo data.
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fail(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

async function removeSeedUsers(db: Db): Promise<number> {
  let removed = 0;
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    fail(error, 'list users');
    const users = data?.users ?? [];
    for (const user of users) {
      if (!isSeedEmail(user.email)) continue;
      const result = await db.auth.admin.deleteUser(user.id);
      fail(result.error, `delete ${user.email}`);
      removed++;
    }
    if (users.length < 200) return removed;
  }
}

async function createUser(db: Db, email: string, username: string, displayName: string) {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  fail(error, `create ${email}`);
  const id = data?.user?.id;
  if (!id) throw new Error(`create ${email}: no id returned`);
  const update = await db
    .from('profiles')
    .update({ username, display_name: displayName.slice(0, 50) })
    .eq('id', id);
  fail(update.error, `profile ${email}`);
  return id;
}

// The same rows create_my_business() writes, then the same function the app's Edge Function
// uses to save an address, so the map point and location row match real data.
async function createBusiness(
  db: Db,
  ownerId: string,
  input: {
    type: 'restaurant' | 'homemade';
    name: string;
    cuisine: string;
    acceptsTables: boolean;
    placeId: string;
    address: string;
    lat: number;
    lng: number;
  },
): Promise<string> {
  const { data, error } = await db
    .from('businesses')
    .insert({
      owner_id: ownerId,
      type: input.type,
      name: input.name,
      cuisine_code: input.cuisine,
      accepts_table_requests: input.type === 'restaurant' && input.acceptsTables,
      is_listed: true,
    })
    .select('id')
    .single();
  fail(error, `business ${input.name}`);
  const businessId = data?.id;
  if (!businessId) throw new Error(`business ${input.name}: no id returned`);

  const seller = await db.from('profiles').update({ is_seller: true }).eq('id', ownerId);
  fail(seller.error, `seller ${input.name}`);

  const located = await db.rpc('set_business_location', {
    p_owner_id: ownerId,
    p_place_id: input.placeId,
    p_formatted_address: input.address,
    p_lat: input.lat,
    p_lng: input.lng,
  });
  fail(located.error, `location ${input.name}`);
  return businessId;
}

async function addMenu(
  db: Db,
  businessId: string,
  name: string,
  given?: MenuLine[],
): Promise<number> {
  const lines = given ?? MENUS[name];
  if (!lines) return 0;
  const currency = await db
    .from('businesses')
    .update({ currency_code: 'CAD' })
    .eq('id', businessId);
  fail(currency.error, `currency ${name}`);
  const { error } = await db.from('menu_items').insert(
    lines.map((line, index) => ({
      business_id: businessId,
      name: line.name,
      description: line.description ?? null,
      price_minor: line.price_minor,
      is_available: line.available ?? true,
      position: index + 1,
    })),
  );
  fail(error, `menu ${name}`);
  return lines.length;
}

function place(seed: Seed, random: () => number) {
  if ('area' in seed.where) {
    const area = AREAS[seed.where.area];
    return {
      city: area.city,
      lat: area.lat + (random() * 2 - 1) * area.spread,
      lng: area.lng + (random() * 2 - 1) * area.spread * 1.3,
      key: area.key,
    };
  }
  return { city: seed.where.city, lat: seed.where.lat, lng: seed.where.lng, key: 'gta' };
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

  console.log(`Seeding the local database at ${url}`);
  const removed = await removeSeedUsers(db);
  console.log(`Removed ${removed} earlier demo account(s).`);

  const random = makeRandom(20261105);
  let visible = 0;
  let menus = 0;
  let menuItems = 0;
  let homemadeVisible = 0;

  try {
    for (const [index, seed] of RESTAURANTS.entries()) {
      const n = String(index + 1).padStart(3, '0');
      const spot = place(seed, random);
      const street = STREETS[index % STREETS.length];
      const owner = await createUser(
        db,
        `seed-restaurant-${n}@example.com`,
        `seed_rest_${n}`,
        seed.name,
      );
      const businessId = await createBusiness(db, owner, {
        type: 'restaurant',
        name: seed.name,
        cuisine: seed.cuisine,
        acceptsTables: index % 3 === 0,
        placeId: `FAKE_PLACE_${spot.key}_${n}`,
        address: `${100 + index * 7} ${street}, ${spot.city}, ON, Canada`,
        lat: spot.lat,
        lng: spot.lng,
      });
      visible++;
      if (seed.menu) {
        menus++;
        menuItems += await addMenu(db, businessId, seed.name);
      }
    }

    // Rows that must stay off the map, at the Oshawa centre so they sit among the visible ones.
    const centre = AREAS.oshawa;
    for (const [index, hidden] of HIDDEN.entries()) {
      const owner = await createUser(
        db,
        `seed-hidden-${hidden.kind.replace('_', '')}@example.com`,
        `seed_hidden_${hidden.kind.replace('_', '')}`,
        hidden.name,
      );
      const businessId = await createBusiness(db, owner, {
        type: hidden.type,
        name: hidden.name,
        cuisine: hidden.cuisine,
        acceptsTables: false,
        placeId: `FAKE_PLACE_hidden_${hidden.kind}`,
        address: `${900 + index} Hidden Rd, Oshawa, ON, Canada`,
        lat: centre.lat + 0.004 * (index + 1),
        lng: centre.lng - 0.004 * (index + 1),
      });
      if (hidden.kind === 'stale') {
        const stale = await db
          .from('business_locations')
          .update({ resolved_at: new Date(Date.now() - 31 * DAY_MS).toISOString() })
          .eq('business_id', businessId);
        fail(stale.error, 'stale');
      } else if (hidden.kind === 'not_found') {
        const gone = await db
          .from('business_locations')
          .update({ place_status: 'not_found' })
          .eq('business_id', businessId);
        fail(gone.error, 'not_found');
      } else if (hidden.kind === 'unlisted') {
        const unlisted = await db
          .from('businesses')
          .update({ is_listed: false })
          .eq('id', businessId);
        fail(unlisted.error, 'unlisted');
        const profile = await db.from('profiles').update({ is_seller: false }).eq('id', owner);
        fail(profile.error, 'unlisted profile');
      }
    }

    // Home cooks. The first is seed-homemade-1 (the demo seller); the rest are numbered.
    let cooks = 0;
    for (const [index, cook] of HOMEMADE_COOKS.entries()) {
      const n = index + 1;
      const spot = place(
        { name: cook.name, cuisine: cook.cuisine, where: { area: cook.area } },
        random,
      );
      const owner = await createUser(
        db,
        `seed-homemade-${n}@example.com`,
        `seed_cook_${n}`,
        cook.name,
      );
      const businessId = await createBusiness(db, owner, {
        type: 'homemade',
        name: cook.name,
        cuisine: cook.cuisine,
        acceptsTables: false,
        placeId: `FAKE_PLACE_home_${spot.key}_${n}`,
        address: `${20 + index * 3} ${STREETS[index % STREETS.length]}, ${spot.city}, ON, Canada`,
        lat: spot.lat,
        lng: spot.lng,
      });
      cooks++;
      if (cook.menu) await addMenu(db, businessId, cook.name, cook.menu);
    }
    homemadeVisible = cooks;

    // Cooks that must stay off the map, among the Oshawa ones.
    for (const [index, hidden] of HOMEMADE_HIDDEN.entries()) {
      const owner = await createUser(
        db,
        `seed-homemade-${hidden.key}@example.com`,
        `seed_cook_${hidden.key}`,
        hidden.name,
      );
      const businessId = await createBusiness(db, owner, {
        type: 'homemade',
        name: hidden.name,
        cuisine: hidden.cuisine,
        acceptsTables: false,
        placeId: `FAKE_PLACE_home_hidden_${hidden.kind}`,
        address: `${700 + index} Quiet Ln, Oshawa, ON, Canada`,
        lat: centre.lat - 0.006 * (index + 1),
        lng: centre.lng + 0.006 * (index + 1),
      });
      if (hidden.kind === 'stale') {
        const stale = await db
          .from('business_locations')
          .update({ resolved_at: new Date(Date.now() - 31 * DAY_MS).toISOString() })
          .eq('business_id', businessId);
        fail(stale.error, 'stale cook');
      } else if (hidden.kind === 'not_found') {
        const gone = await db
          .from('business_locations')
          .update({ place_status: 'not_found' })
          .eq('business_id', businessId);
        fail(gone.error, 'not_found cook');
      } else {
        const unlisted = await db
          .from('businesses')
          .update({ is_listed: false })
          .eq('id', businessId);
        fail(unlisted.error, 'unlisted cook');
        const profile = await db.from('profiles').update({ is_seller: false }).eq('id', owner);
        fail(profile.error, 'unlisted cook profile');
      }
    }
  } catch (error) {
    console.error('Seeding failed; removing the partial demo data so a re-run starts clean.');
    await removeSeedUsers(db).catch(() => undefined);
    throw error;
  }

  console.log('');
  console.log(`Added ${visible} restaurants that SHOULD appear on the map:`);
  console.log('  Oshawa 14, Cambridge 10, downtown Toronto 10, rest of the GTA 14');
  console.log(`  ${menus} of them have a menu (${menuItems} items, prices in CAD).`);
  console.log(
    `Added ${HIDDEN.length} rows that must NOT appear: 31-days-stale, not_found, unlisted.`,
  );
  console.log(`Added ${homemadeVisible} home cooks that SHOULD appear on the Homemade map:`);
  console.log('  Oshawa 5, Cambridge 3, a tight downtown Toronto group of 5 (circles overlap).');
  console.log(
    `Added ${HOMEMADE_HIDDEN.length} cooks that must NOT appear: Stale Samosas, Gone Place, Unlisted Kitchen.`,
  );
  console.log('');
  console.log(`Demo logins: seed-restaurant-001@example.com … password ${PASSWORD}`);
  console.log(
    `Demo cooks: seed-homemade-1@example.com (Nonna Rosa's Table), seed-homemade-stale@example.com`,
  );
  console.log('');
  console.log(
    'Reminder: the place IDs are fake (FAKE_PLACE_…). Directions will not open a real place.',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seeding failed.');
  process.exit(1);
});
