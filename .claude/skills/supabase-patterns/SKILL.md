---
name: supabase-patterns
description: LikeToOrder's Supabase conventions — migrations, RLS policy templates, ownership checks, status-transition functions, storage buckets, Edge Functions, generated types, react-query api layer, homemade approximate location, and pgTAP tests. Use whenever creating or changing tables, policies, functions, storage, edge functions, or src/features/*/api.ts.
---

# LikeToOrder — Supabase patterns

## Golden rules
1. RLS on every table. 2. Ownership checked in SQL. 3. Status changes only via functions. 4. Migrations append-only. 5. Regenerate types after every migration (`npm run db:types`).

## Core tables (logical model — created across specs)
- `profiles` (id = auth.users.id, username unique, display_name, bio, avatar_path, city, is_seller, is_admin)
- `cuisines` (id, iso_code nullable, name, flag_asset, icon) — read-only to clients
- `businesses` (id, owner_id → profiles, type `restaurant|homemade`, name, cuisine_id, accepts_tables bool, lat/lng for restaurants, approx_lat/approx_lng for homemade, status)
- `business_private_addresses` (business_id PK, full_address, lat, lng) — homemade exact location
- `menu_items` (business_id, name, price_cents, photo_path, is_available) / `menu_photos`
- `requests` (id, business_id, customer_id, kind `pickup|table`, status, pickup_at / reserved_at, party_size, items jsonb, note, idempotency_key unique, expires_at, arrived_at)
- `food_logs` (id, author_id, photo_path, description, cuisine_id, is_public, created_at default now(), local_date date not null)
- `promotions` (business_id, starts_at, ends_at, status `draft|active|ended`, activated_by)
- `reports` (business_id, reporter_id, reason, note, status `open|confirmed|rejected`, reviewed_by)

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
Computed server-side in a trigger when the private address is saved: deterministic offset of 200–400 m (seeded by business id) then rounded to 3 decimals; written to `businesses.approx_lat/approx_lng`. Never derive in the app.

Exact address readable via function `get_pickup_address(request_id)` that returns it only when the caller is the customer on an **accepted** request (or the owner).

## Storage
| Bucket | Public? | Path | Notes |
|---|---|---|---|
| `food-logs` | private | `<uid>/<uuid>.jpg` | served with signed URLs; public uploads can use longer-lived signed URLs |
| `business-media` | public | `<business_id>/<uuid>.jpg` | owner-only write via policy joining businesses |
| `avatars` | public | `<uid>/avatar.jpg` | |
Policy pattern: `(storage.foldername(name))[1] = (select auth.uid())::text`. Resize to max 1600px / JPEG 0.8 before upload (expo-image-manipulator).

## Edge Functions
- `places-autocomplete` / `places-resolve`: proxy the map provider with the secret key; verify JWT; validate with zod; return `{ formatted_address, lat, lng }`.
- `send-push`: triggered by DB webhook on request status change.
Secrets via `npx supabase secrets set` — never in `EXPO_PUBLIC_*`.

## App api layer
```ts
// src/features/food-log/api.ts
import { supabase } from '@/lib/supabase';
export async function listFoodLogsByDay(userId: string, day: string) {
  const { data, error } = await supabase.from('food_logs')
    .select('id, description, photo_path, cuisine:cuisines(iso_code,name), created_at')
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
       case when count(distinct cuisine_id) = 1 then min(cuisine_id::text) end as single_cuisine
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
