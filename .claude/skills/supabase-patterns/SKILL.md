---
name: supabase-patterns
description: LikeToOrder's Supabase conventions — migrations, RLS policy templates, ownership checks, status-transition functions, storage buckets, Edge Functions, generated types, react-query api layer, homemade approximate location, and pgTAP tests. Use whenever creating or changing tables, policies, functions, storage, edge functions, or src/features/*/api.ts.
---

# LikeToOrder — Supabase patterns

## Golden rules
1. RLS on every table. 2. Ownership checked in SQL. 3. Status changes only via functions. 4. Migrations append-only. 5. Regenerate types after every migration (`npm run db:types`).

## Local stack
After editing anything in `supabase/templates/`, run `npx supabase stop` then `npx supabase start`: `db reset` does not refresh Kong's template mount, and a stale mount makes GoTrue silently send its default link email instead of our code template.

## Core tables (logical model — created across specs)
- `profiles` (id = auth.users.id, username unique, display_name, bio, avatar_path, city, is_seller, is_admin)
- `cuisines` (code PK — permanent: ISO alpha-2 `IT` or kebab slug `street-food`; kind `country|neutral`; name (`en-x-icu`); generated `flag`; icon (neutral only); sort_order) — read-only to clients (spec 04)
- `businesses` (id, owner_id → profiles unique, type `restaurant|homemade` fixed after creation, name, cuisine_code → cuisines, accepts_table_requests (restaurant only), map_lat/map_lng = public point (restaurant exact, homemade shifted), public_address (restaurant only), is_listed mirrors profiles.is_seller) — spec 05. Clients select only the public columns (not owner_id / is_listed) and update only name, cuisine_code, accepts_table_requests; everything else goes through functions.
- `business_locations` (business_id PK, place_id, formatted_address, lat, lng, resolved_at) — exact location for every business; no client grants, read via `get_my_business()` (owner) and, from specs 09/10, an accepted-request function.
- `places_rate_limits` (user_id, kind, window_kind, window_start, count) — per-user Places quota; only `consume_places_quota()` touches it.
- `currencies` (code PK ISO 4217, name, minor_units 0|2|3) — read-only catalog like `cuisines` (spec 06). `businesses.currency_code` → currencies, one per business, written only by `set_menu_currency()`; locked once any item has a price (`prices_exist`).
- `menu_items` (id, business_id, name, description, price_minor integer in the currency's minor unit (never floats), is_available, position 1..n, deferred unique per business) — one ordered list per business, max 100 (spec 06).
- `business_photos` (id, business_id, kind `cover|gallery|menu|item`, menu_item_id (item only), path, status `pending|ready`, position (gallery/menu), created_at) — limits 1 cover / 6 gallery / 10 menu / 1 per item (spec 06).
- `storage_cleanup_queue` (path PK, business_id, queued_at) — outbox of files whose row is gone; no client grants (spec 06).
- Menu/photo writes: only via functions (`create_menu_item`, `update_menu_item`, `move_menu_item`, `delete_menu_item`, `begin_photo_upload`, `finish_photo_upload`, `delete_business_photo`, `claim_photo_cleanup`) that lock the caller's business row (`select … where owner_id = auth.uid() for update`), so limits hold under concurrent calls.
- `requests` (id, business_id, customer_id, kind `pickup|table`, status, pickup_at / reserved_at, party_size, items jsonb, note, idempotency_key unique, expires_at, arrived_at)
- `food_logs` (id, author_id, photo_path, description, cuisine_code, is_public, created_at default now(), local_date date not null)
- `promotions` (business_id, starts_at, ends_at, status `draft|active|ended`, activated_by)
- `reports` (business_id, reporter_id, reason, note, status `open|confirmed|rejected`, reviewed_by)

## Grants
Every new table migration starts with `revoke all on <table> from anon, authenticated`, then grants only what the spec lists; the anon-privileges pgTAP test enforces this.
Every new callable function: revoke execute from anon/public, grant only where the spec says, and add a pgTAP check with an allowlist (Supabase grants execute on new `public` functions by default).

**Read-only lookup tables** (e.g. `cuisines`): `revoke all … from anon, authenticated`, then `grant select … to anon, authenticated`; one `for select to anon, authenticated using (true)` policy; no write grants or policies (only migrations change it; seed rows in the migration, not `seed.sql`). `using (true)` is only for tables with no user-owned or private data. Add the table to the ALLOWLIST block in `supabase/tests/03-navigation-shell.test.sql` only together with its own pgTAP checks for **both** anon and authenticated: `table_privs_are('public', '<table>', '<role>', array['SELECT'])` and `not has_any_column_privilege('<role>', 'public.<table>', 'INSERT, UPDATE, REFERENCES')` — the allowlist removes the table from the generic anon check, so these are what still catch a stray write grant. If keys are permanent, add a `before update or delete … for each row` guard trigger that blocks key changes and deletes, plus a `before truncate … for each statement` trigger on the same function (row triggers don't fire on TRUNCATE), and revoke execute on the function from `public, anon, authenticated`. Reference keys from other tables as `<x>_code text not null references public.<table>(code) on update restrict on delete restrict`.

## RLS templates
```sql
alter table public.food_logs enable row level security;

-- read: public rows, or my own
create policy "food_logs_select" on public.food_logs for select
  using (is_public or author_id = (select auth.uid()));

-- insert: only as myself
create policy "food_logs_insert" on public.food_logs for insert
  with check (author_id = (select auth.uid()));

-- owner of a business
create policy "menu_items_owner_write" on public.menu_items for all
  using (exists (select 1 from public.businesses b
                 where b.id = business_id and b.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.businesses b
                 where b.id = business_id and b.owner_id = (select auth.uid())));
```
Use `(select auth.uid())` (wrapped) — it's evaluated once per query, much faster.

## Status transitions (requests)
No update policy on `requests.status` for clients. Use functions:
```sql
create or replace function public.respond_to_request(p_request_id uuid, p_decision text)
returns public.requests
language plpgsql security definer set search_path = ''
as $$
declare r public.requests;
begin
  select * into r from public.requests where id = p_request_id for update;
  if not found then raise exception 'not_found'; end if;
  if not exists (select 1 from public.businesses b
                 where b.id = r.business_id and b.owner_id = auth.uid()) then
    raise exception 'forbidden';
  end if;
  if r.status <> 'pending' or r.expires_at < now() then raise exception 'invalid_transition'; end if;
  if p_decision not in ('accepted','declined') then raise exception 'invalid_decision'; end if;
  update public.requests set status = p_decision, responded_at = now()
   where id = p_request_id returning * into r;
  return r;
end $$;
revoke all on function public.respond_to_request from public, anon;
grant execute on function public.respond_to_request to authenticated;
```
Allowed transitions: `pending → accepted | declined | expired | cancelled`; `accepted → completed | no_show | cancelled`.
Expiry: a `pg_cron` job (or check-on-read) sets `expired` where `status='pending' and expires_at < now()`.

## Server-owned values
- `created_at timestamptz not null default now()`; clients never send it (exclude from insert grants or overwrite in a `before insert` trigger).
- `food_logs.local_date`: computed in a `before insert` trigger from `now()` and the client-supplied IANA timezone validated against `pg_timezone_names` — so no backdating.
- Idempotency: `requests.idempotency_key uuid unique` generated client-side per submit attempt; insert with `on conflict do nothing` and return the existing row.

## Homemade approximate location
Computed in SQL inside `set_business_location()` (spec 05, Decisions 3 and 10): a random bearing and a random distance of 200–500 m (uniform over the ring's area), stored in `businesses.map_lat/map_lng`. The offset and random inputs are never stored. Re-rolled **only when `place_id` changes**: saving the same place again, or a Places coordinate refresh, keeps the point (re-rolling would let an observer average points back to the real one). Never compute, round or display an offset in the app.

Exact address: the owner reads it through `get_my_business()`. Specs 09/10 add a function (e.g. `get_pickup_address(request_id)`) that returns it only to the customer on an **accepted** request.

## Storage
| Bucket | Public? | Path | Notes |
|---|---|---|---|
| `food-logs` | private | `<uid>/<uuid>.jpg` | served with signed URLs; public uploads can use longer-lived signed URLs |
| `business-media` | **private** | `<business_id>/<photo_id>.jpg` | spec 06: created in the migration (2 MB, jpeg/png/webp); signed URLs (1 h), so photos vanish when seller mode is off. Never a user id in the path (would link a listing to an account) |
| `avatars` | public | `<uid>/avatar.jpg` | |
User-folder policy pattern: `(storage.foldername(name))[1] = (select auth.uid())::text`. Photos go through `src/features/media` `prepareImage` (max 1600 px long edge, JPEG 0.8 → 0.6 retry, EXIF/GPS check on the output bytes) before upload. Buckets are created in migrations (`insert into storage.buckets …`), not `config.toml`, so local and remote match.

**Reserve → upload → finish (business-media):** the client never picks a path.
1. `begin_photo_upload(kind, item_id)` checks the limit under the business lock, inserts a `pending` row and returns `{photo_id, path}`. Cover/item: a new reservation replaces the pending one for that slot (retry). Pending rows expire after 1 hour.
2. The app uploads to that path (upsert false). The insert policy allows only a fresh pending path of a business the caller owns (`private.photo_upload_allowed(name)`).
3. `finish_photo_upload(photo_id)` checks the object exists in `storage.objects` with an allowed `metadata->>'mimetype'` and `size`, then marks the row `ready` (and deletes a replaced cover/item row). Storage checks the *declared* content type, not the bytes (known v1 limit).

**Cleanup outbox ("row first, file later"):** an `AFTER DELETE` trigger on `business_photos` (also fires on FK cascades) writes the path to `storage_cleanup_queue` in the same transaction. The app calls `claim_photo_cleanup()`, removes the returned paths via the Storage API, and calls it again; the server drops queue rows whose object is gone. The delete policy allows only files whose row is gone (`not private.photo_is_live(name)`). No server sweeper in v1.

**`private` schema for cross-table policies:** a policy can't read columns clients have no privilege on (e.g. `businesses.owner_id`), so it calls a `security definer stable` helper with `set search_path = ''` in the `private` schema (not in `[api] schemas`, so PostgREST can't call it): `private.business_is_public`, `owns_business`, `photo_upload_allowed`, `photo_is_public`, `photo_is_live`. Revoke execute from `public`, grant to `anon, authenticated`. Guard casts in policies: `case when (storage.foldername(name))[1] ~ '<uuid regex>' then … ::uuid … else false end`, so a malformed name fails closed instead of erroring.

**pgTAP on storage:** insert into `storage.objects (bucket_id, name, metadata)` as the impersonated role to simulate an upload (RLS applies). Supabase blocks direct SQL deletes on `storage.objects` with a statement trigger (42501); `set local storage.allow_delete_query = 'true'` first so delete tests exercise the policy — a refused delete then removes 0 rows rather than erroring. CI's database-only `supabase db start` + `db reset` includes the full storage schema (checked in spec 06), so no Storage container is needed for tests.

## Edge Functions
- **Pattern:** `index.ts` only reads env and wires real dependencies into a pure `handler.ts` (`createHandler(deps)`); Deno tests inject fakes (`getUser`, quota, Google client, DB calls) and never reach the network. Shared code in `supabase/functions/_shared/`.
- **Auth:** `verify_jwt = true` in `config.toml` is not enough (the anon key is a valid JWT); every handler calls `requireUser(req, deps.getUser)` and returns 401 without a user. `getUser` is injected: `index.ts` passes `createGetUser(anonClient)` (wrapping `supabase.auth.getUser(jwt)`), tests pass a fake.
- **Owner from the JWT, never the body.** Service-role DB calls take the verified user id.
- **Rate limit:** `consume_places_quota(user_id, kind)` (service role) before any paid upstream call. It refuses ineligible users before counting (`profile_incomplete` → 403; `no_business` for resolve → 404) and returns false over the limit → 429. Limits: autocomplete 30/min, 100/day; resolve 5/min, 5/day.
- `places-autocomplete`: `{ input, sessionToken }` → `{ suggestions: { placeId, primaryText, secondaryText }[] }` (max 5).
- `places-resolve`: `{ placeId, sessionToken }` → Place Details (field mask `id,formattedAddress,location`) → `set_business_location(user.id, …)` → returns the owner view (same shape as `get_my_business()`). The client never sends coordinates or an address string.
- Errors are `{ error: { code } }`; upstream bodies are never echoed. Log status, function name and latency only.
- `send-push`: triggered by DB webhook on request status change.
Secrets via `npx supabase secrets set` — never in `EXPO_PUBLIC_*`.

## App api layer
```ts
// src/features/food-log/api.ts
import { supabase } from '@/lib/supabase';
export async function listFoodLogsByDay(userId: string, day: string) {
  const { data, error } = await supabase.from('food_logs')
    .select('id, description, photo_path, cuisine:cuisines(code,name,flag,icon), created_at')
    .eq('author_id', userId).eq('local_date', day).order('created_at');
  if (error) throw error;
  return data;
}
```
Hooks wrap these with react-query: keys like `['food-logs', userId, day]`; invalidate on mutation success.

## Activity grid query
Aggregate in SQL, not the app:
```sql
select local_date, count(*) as n,
       case when count(distinct cuisine_code) = 1 then min(cuisine_code) end as single_cuisine
from public.food_logs
where author_id = $1 and local_date >= $2
group by local_date;
```
Expose via an RPC `activity_grid(p_user uuid, p_from date)` that applies the public/private rule (visitors count public only).

## pgTAP skeleton
```sql
begin;
select plan(3);
select ok((select relrowsecurity from pg_class where oid = 'public.food_logs'::regclass), 'RLS on');
-- impersonate outsider
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.food_logs where not is_public)::int, 0, 'outsider sees no private logs');
select throws_ok($$ select public.respond_to_request('...', 'accepted') $$, 'forbidden');
select * from finish();
rollback;
```
