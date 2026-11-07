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
- `business_locations` (business_id PK, place_id, formatted_address, lat, lng, resolved_at) — exact location for every business; no client grants, read via `get_my_business()` (owner) and `get_my_pickup_address(request_id)` (spec 09: only the requesting customer, only at `accepted`/`completed`, homemade only).
- `places_rate_limits` (user_id, kind, window_kind, window_start, count) — per-user Places quota; only `consume_places_quota()` touches it.
- `currencies` (code PK ISO 4217, name, minor_units 0|2|3) — read-only catalog like `cuisines` (spec 06). `businesses.currency_code` → currencies, one per business, written only by `set_menu_currency()`; locked once any item has a price (`prices_exist`).
- `menu_items` (id, business_id, name, description, price_minor integer in the currency's minor unit (never floats), is_available, position 1..n, deferred unique per business) — one ordered list per business, max 100 (spec 06).
- `business_photos` (id, business_id, kind `cover|gallery|menu|item`, menu_item_id (item only), path, status `pending|ready`, position (gallery/menu), created_at) — limits 1 cover / 6 gallery / 10 menu / 1 per item (spec 06).
- `storage_cleanup_queue` (path PK, business_id, queued_at) — outbox of files whose row is gone; no client grants (spec 06).
- Menu/photo writes: only via functions (`create_menu_item`, `update_menu_item`, `move_menu_item`, `delete_menu_item`, `begin_photo_upload`, `finish_photo_upload`, `delete_business_photo`, `claim_photo_cleanup`) that lock the caller's business row (`select … where owner_id = auth.uid() for update`), so limits hold under concurrent calls.
- `pickup_requests` (spec 09: id, business_id, customer_id, status `pending|accepted|declined|expired|cancelled|completed|no_show`, pickup_at, items jsonb snapshot `[{item_id,name,unit_price_minor,quantity}]` read from `menu_items` in SQL, order_text, note, currency_code, `unique (customer_id, idempotency_key)`, expires_at, responded_at). RLS on, **no grants and no policies**: customers use `submit_pickup_request`, `list_my_pickup_requests`, `get_my_pickup_request`, `cancel_pickup_request`, `get_my_pickup_address`; the cron job `pickup-requests-expire` runs `private.expire_pickup_requests()` every minute. Reads return `server_now` and a server-computed `display_status`. Spec 10 adds the seller's functions; table requests (spec 11) decide between a second table and a `kind` column.
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
Allowed transitions (pickup requests): `pending → cancelled` (customer, pending only, spec 09), `pending → expired` (cron), `pending → accepted | declined` and `accepted → completed | no_show` (seller, spec 10). There is no `accepted → cancelled` in v1.
Expiry: the `pg_cron` job sets `expired` where `status='pending' and expires_at <= now()`, **and** the read functions compute `display_status` in SQL (`pending` past `expires_at` shows `expired`), so a request is never shown live after it expired. Every transition function refuses a request at or past `expires_at` (`<=`, the same line as the job).

## Server-owned values
- `created_at timestamptz not null default now()`; clients never send it (exclude from insert grants or overwrite in a `before insert` trigger).
- `food_logs.local_date`: computed in a `before insert` trigger from `now()` and the client-supplied IANA timezone validated against `pg_timezone_names` — so no backdating.
- Idempotency: `idempotency_key uuid`, unique **per customer** (`unique (customer_id, idempotency_key)`), generated client-side once per form session. The submit function looks the key up first and returns that row unchanged, before any other check; it also takes a per-customer `pg_advisory_xact_lock` so concurrent calls serialise, and still inserts with `on conflict do nothing` and re-selects.
- Free text from customers (`order_text`, `note`) refuses hidden characters in both the function and a table check: ASCII controls except newline, DEL, C1 controls, zero-width (U+200B-200D, U+FEFF) and bidi overrides/isolates (U+202A-202E, U+2066-2069). Mirror the same set in the app's strip.
- Per-customer limits that count rows (spec 09: 5 pending, 1 pending per business, 10 submits an hour) read the customer's own table rows under that lock. A pending row past `expires_at` does not count. This needs no counter table or cleanup job.

## Homemade approximate location
Computed in SQL inside `set_business_location()` (spec 05, Decisions 3 and 10): a random bearing and a random distance of 200–500 m (uniform over the ring's area), stored in `businesses.map_lat/map_lng`. The offset and random inputs are never stored. Re-rolled **only when `place_id` changes**: saving the same place again, or a Places coordinate refresh, keeps the point (re-rolling would let an observer average points back to the real one). Never compute, round or display an offset in the app.

Exact address: the owner reads it through `get_my_business()`. `get_my_pickup_address(request_id)` (spec 09) returns it only to the requesting customer while the request is `accepted` or `completed`, for homemade businesses that are still listed, and `null` for every other cause; it is not behind the 30-day map guard (spec 09 Decision 5), but it stops 24 hours after `pickup_at`, and it returns the cook's current address until spec 10's accept function snapshots it onto the request. Spec 10 adds the seller's accept function.

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

**Cleanup outbox ("row first, file later"):** an `AFTER DELETE` trigger on `business_photos` (also fires on FK cascades) writes the path to `storage_cleanup_queue` in the same transaction. The app calls `claim_photo_cleanup()`, removes the returned paths via the Storage API, and calls it again; the server drops queue rows older than 10 minutes whose object is gone (a younger row may have an upload in flight). `begin_photo_upload` raises `cleanup_required` while 20 or more queued files are still in storage, so a client that never cleans up can't grow storage without limit; the app runs the cleanup and retries once. The delete policy allows only files whose row is gone (`not private.photo_is_live(name)`). No server sweeper in v1.

**`private` schema for cross-table policies:** a policy can't read columns clients have no privilege on (e.g. `businesses.owner_id`), so it calls a `security definer stable` helper with `set search_path = ''` in the `private` schema (not in `[api] schemas`, so PostgREST can't call it): `private.business_is_public`, `owns_business`, `photo_upload_allowed`, `photo_is_public`, `photo_is_live`. Revoke execute from `public`, grant to `anon, authenticated`. Guard casts in policies: `case when (storage.foldername(name))[1] ~ '<uuid regex>' then … ::uuid … else false end`, so a malformed name fails closed instead of erroring.

**pgTAP on storage:** insert into `storage.objects (bucket_id, name, metadata)` as the impersonated role to simulate an upload (RLS applies). Supabase blocks direct SQL deletes on `storage.objects` with a statement trigger (42501); `set local storage.allow_delete_query = 'true'` first so delete tests exercise the policy — a refused delete then removes 0 rows rather than erroring. CI's database-only `supabase db start` + `db reset` includes the full storage schema (checked in spec 06), so no Storage container is needed for tests.

## Public read functions, guest limit, cron and vault (spec 07)
- **Public reads that guests may call** are `security definer`, `set search_path = ''`, `set statement_timeout = '3s'`, `returns jsonb`, with `revoke execute … from public, anon, authenticated` then `grant execute … to anon, authenticated`. They return only public fields (never `place_id` in a list, never exact coordinates, `resolved_at`, status columns), and one `null` for every reason a row is not shown, so nothing leaks about why. One shared SQL helper holds the visibility rule (`private.restaurant_is_fresh`) so list and detail cannot drift.
- **Bounding-box reads:** validate (null/NaN/inf/inverted → `invalid_bounds`), clamp latitude, wrap longitude, measure spans on the raw numbers (a raw `min_lng > max_lng` wraps: span = max − min + 360), answer `too_large` above 90° with no scan, `limit cap + 1` and report `capped`. Partial index on the lat/lng columns.
- **Guest rate limit (`private.consume_map_quota`):** key `u:<uid>` for signed-in callers only; guests count against the global `guest:all` key first (so a flood creates no new rows) and then `ip:<address>` from the first `x-forwarded-for` value in `current_setting('request.headers', true)`, parsed in an exception block and cast to `inet`. A guest with no readable address is counted against `guest:all` only. The address is read in one place, `private.caller_ip()`, so the launch fix is a one-function migration. The header is **not confirmed** trustworthy (Supabase's docs don't say), so the global ceiling is the real protection. A refused call raises, which rolls back its own increment. Public functions never delete rows; cron does.
- **Homemade reads (spec 08):** `map_homemade_in_bounds` and `get_homemade_details` mirror the restaurant pair, behind `private.homemade_is_fresh`, and return only the shifted `map_lat`/`map_lng` (never `business_locations`, `place_id` or an address). Rate-limit kinds are `pins`, `details`, `homemade_pins`, `homemade_details`; `consume_map_quota` hard-codes them, so a new kind needs the check constraint on `map_rate_limits.kind` **and** that function changed. `guest:all` is counted per kind, so the tabs have separate guest ceilings.
- **Cron + vault + pg_net:** `pg_cron` runs `private.*` functions (`cron.schedule(name, schedule, command)` upserts by name, so a migration can be re-applied). A function that calls an Edge Function reads the URL and a shared secret from `vault.decrypted_secrets`, sends them with `net.http_post(url, headers, body, timeout_milliseconds)`, and returns quietly when the secrets are absent (CI, tests, local). The Edge Function has `verify_jwt = false` and checks the secret itself (`x-cron-secret`, constant-time, 401 with no body, 500 `not_configured` when unset). Revoke execute on every `private.*` function from everyone, including `service_role`.
- **Claim / apply for a background job:** `claim_*` (service role only) locks the quota row, takes `least(batch, cap, remaining)` due rows with `for update skip locked`, stamps them (`refresh_attempted_at`), and charges the quota for the rows actually returned. `apply_*` (service role only) records one row's result and **applies it only to a row with an outstanding claim** (`refresh_attempted_at is not null`); the function that saves a new user-entered value (`set_business_location`) clears the stamp, so a result claimed for the old value can never overwrite the new one. Results are saved one row at a time, as each finishes.
- **Apply clears its claim:** `apply_*` sets the claim stamp back to null for every applied outcome, so a second call for the same claim finds nothing outstanding and does nothing. Test it with a second apply.
- **Google-derived columns are not table-readable:** coordinates and addresses taken from Google Places (`businesses.map_lat`, `map_lng`, `public_address`) have `select` revoked from `anon` and `authenticated`; clients get them only through the rate-limited, freshness-checked functions (owner: `get_my_business`). A table grant would let anyone page through hidden rows without the limit.
- **A function-level `statement_timeout` does not bound the call itself** (the timer starts with the outer statement). The role-level timeouts do; do not describe the function setting as the cost bound.
- A raise rolls back the whole call, including a counter bumped earlier in it, so the order "validate, then count" cannot be proven by a test; do not write one.

## Edge Functions
- **Pattern:** `index.ts` only reads env and wires real dependencies into a pure `handler.ts` (`createHandler(deps)`); Deno tests inject fakes (`getUser`, quota, Google client, DB calls) and never reach the network. Shared code in `supabase/functions/_shared/`.
- **Auth:** `verify_jwt = true` in `config.toml` is not enough (the anon key is a valid JWT); every handler calls `requireUser(req, deps.getUser)` and returns 401 without a user. `getUser` is injected: `index.ts` passes `createGetUser(anonClient)` (wrapping `supabase.auth.getUser(jwt)`), tests pass a fake.
- **Owner from the JWT, never the body.** Service-role DB calls take the verified user id.
- **Rate limit:** `consume_places_quota(user_id, kind)` (service role) before any paid upstream call. It refuses ineligible users before counting (`profile_incomplete` → 403; `no_business` for resolve → 404) and returns false over the limit → 429. Limits: autocomplete 30/min, 100/day; resolve 5/min, 5/day.
- `places-autocomplete`: `{ input, sessionToken }` → `{ suggestions: { placeId, primaryText, secondaryText }[] }` (max 5).
- `places-resolve`: `{ placeId, sessionToken }` → Place Details (field mask `id,formattedAddress,location`) → `set_business_location(user.id, …)` → returns the owner view (same shape as `get_my_business()`). The client never sends coordinates or an address string.
- Errors are `{ error: { code } }`; upstream bodies are never echoed. Log status, function name and latency only.
- `places-refresh` (spec 07): POST from `pg_cron` via `pg_net` with `x-cron-secret`; claims up to 25 rows, asks Google for `id,location` one row at a time (5 s timeout each), saves each result at once through `apply_places_refresh`, and answers counts only `{ claimed, ok, not_found, failed }`. `not_found` only for HTTP 404 **and** body `error.status == NOT_FOUND`; every other failure is `failed` and the row is retried after a day. Nothing from Google, the key or the secret is logged.
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
