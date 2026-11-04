# Spec 06: Menu Management

**Branch:** two PRs from this one spec (Decision 11)
- PR 1 (Gate A: database, storage bucket and policies, pgTAP, types): `feature/menu-management-backend` (this branch; renamed from `feature/menu-management` before its first push)
- PR 2 (Gates B + C + D + manual run: the app): `feature/menu-management-app`, created from `main` after PR 1 is merged
**Product spec:** `docs/product/v1.md` §5 Sellers & listings (Menus, "change … menu any time from Manage Business", Homemade specifics), §6 (the bottom sheet will show photos, menu, prices and availability; not built here), §3 (out of scope), §14 row 06
**Plan mode:** required — adds tables, RLS, callable functions, a storage bucket and storage policies; adds dependencies (image picker, manipulator, image, file system, localization); adds routes under `app/seller/`; touches well over ~5 files.
**Status:** 🚧 In progress (PR 1 database and storage on `feature/menu-management-backend`)

## Overview
After this ships, a seller can build their menu from **Manage Business**. A menu is one ordered list of items, with no sections. Each item has a name and can also have a description, a price, one photo and an available/unavailable setting. The seller moves items up and down with buttons, so reordering never depends on dragging. A seller can also upload **menu photos** (up to 10) instead of items, or as well as items, plus one **cover photo** and up to 6 **gallery photos**. Prices are optional. When used, they are in **one currency per business**, which the seller chooses.

Every photo is resized on the phone before upload, and its hidden metadata (EXIF, including GPS location) is removed. The app checks the actual bytes before sending them, because a homemade cook's photos must never reveal their home. Photos sit in a private storage bucket. Anyone can see them while the business is listed; they disappear when seller mode is off. Only the owner can upload or delete them, and only inside their own business's folder. The photo limits are enforced in the database, not only in the UI. Deleting an item or a photo also deletes the stored file (see "No orphaned files").

Guests and other users get **read access** to the menus and photos of listed businesses for specs 07/08, but nothing is shown on a map or sheet yet.

The image picking, resizing, metadata check and upload pieces are built as shared code in `src/features/media/`. Spec 13 (food log and profile photo) will reuse them.

**Why now:** the bottom sheet (07, 08) shows photos and menus, and pickup requests (09) let customers choose items. Both need menus to exist.

## Depends on
- 02 auth-and-profiles (✅ Shipped)
- 04 cuisine-catalog (✅ Shipped; display rule wherever a cuisine appears)
- 05 seller-onboarding (✅ Shipped; `businesses`, `get_my_business`, `business_owner_view`, the seller screen pattern, Decision 14 routing, the function allowlist)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §3, §5, §6
- This spec
- `.claude/skills/supabase-patterns/SKILL.md`, `.claude/skills/liketoorder-ui/SKILL.md`
- `supabase/migrations/20261103215641_seller_onboarding.sql` (businesses, `business_owner_view`, revoke-then-grant, function style)
- `supabase/tests/05-seller-onboarding.test.sql` (impersonation pattern, `column_privs_are` on `businesses`, the function allowlist at L158-178)
- `supabase/tests/03-navigation-shell.test.sql` (table ALLOWLIST at L16-37), `supabase/tests/00_rls_enabled.test.sql`
- `supabase/config.toml` (`[storage]`, `[api] schemas`), `.github/workflows/ci.yml` (database-only start)
- `src/features/sellers/api.ts`, `schema.ts`, `messages.ts`, `sellerRoutes.ts`, `hooks/useMyBusiness.ts`
- `src/features/sellers/components/ManageBusinessScreen.tsx`, `SellerScreenGate.tsx`, `SellerScreenFrame.tsx`, `SellerLoading.tsx`, `LabelledSwitch.tsx`
- `src/features/sellers/__tests__/sellerRouting.test.tsx` (real-route test pattern)
- `src/features/cuisines/components/CuisinePicker.tsx` (searchable modal pattern for the currency picker)
- `app/seller/_layout.tsx`, `app/seller/edit.tsx`
- `src/components/ui/index.ts`, `src/theme/tokens.ts`, `jest.setup.ts`, `app.config.ts`

## User stories
- As a seller, I can add, edit and delete menu items (name, optional description, optional price, optional photo, available yes/no), so that customers can see what I offer.
- As a seller, I can mark an item unavailable without deleting it.
- As a seller, I can move an item up or down with buttons, so that I can reorder without dragging, including with a screen reader.
- As a seller, I can upload menu photos instead of typing items, or as well as items.
- As a seller, I can set one cover photo and up to 6 gallery photos, and replace or delete any of them.
- As a seller, I choose my menu's currency once. The app suggests my phone's currency, and prices show in the right format for my currency and my phone's language.
- As a homemade cook, I know my photos never carry my home's location in their hidden data.
- As a guest or another user, I can read the menu and photos of any listed business (for specs 07/08), but never those of a hidden business.
- As a screen-reader user, every photo has a spoken name and every control is labelled.

## Screens & routes
All new routes are under `app/seller/`, which is already behind the profile guard in `app/_layout.tsx` (signed in, profile complete). Access: **has a business** (seller mode on or off), the same as `/seller/edit`.

- `app/(tabs)/manage.tsx` (no change). `ManageBusinessScreen` gains two rows after "Change address": **Menu** ("12 items · 2 menu photos" or "No menu yet") → `/seller/menu`, and **Photos** ("Cover set · 3 gallery photos" or "No photos yet") → `/seller/photos`.
- `app/seller/menu/index.tsx` (new) — `MenuScreen`:
  - A **Currency** row showing "Canadian dollar (CAD)" or "Not set". It opens `CurrencyPicker` and is read-only, with a reason, once any item has a price (Decision 12).
  - The item list in order. Each row shows the name, the formatted price (or nothing), an "Unavailable" text tag (text, not color only), a thumbnail if there is one, **Move up** and **Move down** buttons, and an **Available** switch.
  - "Add item" (disabled with a reason at 100 items), and a "Menu photos (n/10)" row → `/seller/photos#menu`.
- `app/seller/menu/new.tsx` (new) and `app/seller/menu/[itemId].tsx` (new) — `MenuItemFormScreen`:
  - Fields: name, description, price, available, photo (add / replace / remove).
  - The price field shows the currency code and accepts the currency's number of decimals. If the business has no currency yet and the seller types a price, a currency field appears, pre-filled with the suggestion. Saving sets the currency first, then saves the item.
  - Edit mode has **Delete item**, with a confirm dialog.
  - Unknown or deleted `itemId`: the empty state "This item no longer exists" with a Back button.
- `app/seller/photos.tsx` (new) — `BusinessPhotosScreen`, with three sections:
  - **Cover** (1): add / replace / remove.
  - **Gallery** (up to 6): add / remove each.
  - **Menu photos** (up to 10): add / remove each.

  Each section shows its count ("3 of 6"). Add is disabled with a reason when the section is full. Photos stay in upload order (reordering photos is out of scope). For homemade sellers only, a note: "Photos are public. Avoid showing your house number, front door or street sign." (Decision 18.)

**Access rules (Decision 14 pattern, extended):** `SellerScreen` gains `'menu' | 'menu-item' | 'photos'`. They follow the same rule as `'edit'`: no business → `<Redirect href="/seller/onboarding">`. They use `SellerScreenGate`, show `SellerLoading` while `useMyBusiness` loads, and redirect only after the data loads. The root layout and `app/seller/_layout.tsx` add **no** guard on business or menu data, and nothing unmounts the Stack while loading. The menu and photo queries load inside the gated screen, each with its own skeleton or error.

**4 states** on every new screen:
- **Loading:** `Skeleton`.
- **Error:** `ErrorState` with retry.
- **Empty:** "No menu items yet. Add your first item, or upload menu photos instead." / "No photos yet" / the missing item.
- **Success.**

## Database changes
One migration, `npx supabase migration new menu_management`.

```sql
-- ── Private schema for RLS helper functions (not exposed by the API) ───────────
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

-- ── Currencies: ISO 4217, active circulating currencies only ──────────────────
create table public.currencies (
  code         text primary key check (code ~ '^[A-Z]{3}$'),
  name         text not null check (char_length(name) between 1 and 60),  -- English name
  minor_units  smallint not null check (minor_units in (0, 2, 3))         -- ISO 4217 "minor unit"
);
-- Seeded in the migration (~155 rows). Excludes fund codes (e.g. CLF, UYW: 4 decimals),
-- precious metals (XAU …), SDR/XDR, XTS, XXX. Same guard pattern as cuisines: no client writes.

-- ── Businesses: one menu currency ──────────────────────────────────────────────
alter table public.businesses
  add column currency_code text references public.currencies(code) on update restrict on delete restrict;
-- Null until chosen. Written only by set_menu_currency().

-- ── Menu items: one ordered list per business ─────────────────────────────────
create table public.menu_items (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80 and name = btrim(name)
                                     and name !~ '[[:cntrl:]]'),
  description   text check (char_length(description) between 1 and 300 and description = btrim(description)
                            and description !~ '[\x00-\x09\x0B-\x1F\x7F]'),   -- newlines allowed
  price_minor   integer check (price_minor between 1 and 999999999),      -- whole minor units; null = no price
  is_available  boolean not null default true,
  position      integer not null check (position >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint menu_items_position_unique unique (business_id, position) deferrable initially deferred
);
create trigger menu_items_set_updated_at before update on public.menu_items
  for each row execute function public.set_updated_at();

-- ── Business photos: cover, gallery, menu photos and item photos ──────────────
create table public.business_photos (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  kind          text not null check (kind in ('cover', 'gallery', 'menu', 'item')),
  menu_item_id  uuid references public.menu_items(id) on delete cascade,
  path          text not null unique,          -- '<business_id>/<id>.jpg', set by the server
  status        text not null default 'pending' check (status in ('pending', 'ready')),
  position      integer,                       -- gallery/menu order; null for cover/item
  created_at    timestamptz not null default now(),   -- server time; pending rows expire after 1 hour
  constraint business_photos_item_link check ((kind = 'item') = (menu_item_id is not null)),
  constraint business_photos_path_shape check (path = business_id::text || '/' || id::text || '.jpg')
);
create unique index business_photos_one_cover on public.business_photos (business_id)
  where kind = 'cover' and status = 'ready';
create unique index business_photos_one_per_item on public.business_photos (menu_item_id)
  where kind = 'item' and status = 'ready';
create index business_photos_business_idx on public.business_photos (business_id, kind, status);

-- ── Storage cleanup queue (outbox): files to remove after their row is gone ───
create table public.storage_cleanup_queue (
  path         text primary key,
  business_id  uuid not null,      -- no FK: rows must outlive a deleted business
  queued_at    timestamptz not null default now()
);
-- AFTER DELETE trigger on business_photos (also fires on FK cascades from
-- menu_items and businesses): insert old.path into the queue, on conflict do nothing.
```

**Price model (Decision 12):**
- One currency per business, stored as `businesses.currency_code`. Prices are integers in the currency's **minor unit** from ISO 4217: JPY/KRW/VND/CLP/ISK have 0 decimals, USD/CAD/EUR have 2, and BHD/KWD/JOD/OMR/TND/IQD have 3. So ¥1200 is `1200`, $12.50 is `1250` and 1.250 KWD is `1250`. No floats anywhere.
- `minor_units` comes from the `currencies` table, the single source for parsing input and for display. The app forces exactly `minor_units` decimals when formatting, even where the device's locale data (CLDR) would show fewer (e.g. IQD).
- Display: `Intl.NumberFormat(deviceLocale, { style: 'currency', currency, minimumFractionDigits: mu, maximumFractionDigits: mu })`, so the symbol, separators and order follow the viewer's phone language.
- **Default:** nothing is set until the seller first needs a price. The picker is pre-filled with the phone's currency (`expo-localization` `getLocales()[0].currencyCode`) if that code is in `currencies`, otherwise no pre-selection. The seller confirms it. I considered using the country of the business address instead (more accurate for a seller travelling abroad), but it needs a Places field-mask change in the Edge Function and more cached Google data, so it isn't proposed.
- **Changing currency:** allowed only while **no item has a price**. Once a price exists, `set_menu_currency` raises `prices_exist`. Changing it then would silently re-read every amount (¥1200 → $12.00). To switch, the seller removes the prices first. There is no "clear all prices" shortcut (Decision 12).
- A price can be set only when the business has a currency (`currency_required`).

**Limits (Decision 17):** 100 items per business. Photos: 1 cover, 6 gallery, 10 menu, and 1 per item. All are checked inside the functions while holding a `for update` lock on the business row, so two parallel calls cannot both slip under a limit.

### RLS and grants
All four new tables: `enable row level security`, then `revoke all … from anon, authenticated`, in the same migration.

**Private helpers** (`private` schema, `security definer`, `stable`, `set search_path = ''`, execute revoked from `public` then granted to `anon, authenticated`). They are needed because a policy on one table cannot read `businesses.owner_id` / `is_listed`: clients hold no column privilege on those.
- `private.business_is_public(p_business_id uuid) returns boolean`: `is_listed and map_lat is not null`, the same rule as `businesses_select_public`.
- `private.owns_business(p_business_id uuid) returns boolean`: `owner_id = auth.uid()`.
- `private.photo_upload_allowed(p_path text) returns boolean`: a `pending` row with this exact path, less than 1 hour old, for a business the caller owns.
- `private.photo_is_public(p_path text) returns boolean`: a `ready` row with this path whose business is public.
- `private.photo_is_live(p_path text) returns boolean`: any row with this path exists. Used to stop deletes of live files.

These leak nothing beyond what the public `businesses` select already shows. `private` is not in `[api] schemas`, so PostgREST cannot call them.

**`currencies`:** `grant select … to anon, authenticated`, with policy `using (true)`. No write grants. A guard trigger blocks writes, like `cuisines_guard`.

**`businesses`:** add `currency_code` to the existing column `select` grant for anon and authenticated. No update grant: it is written via `set_menu_currency()`. The spec 05 exact `column_privs_are` checks are updated to include it.

**`menu_items`:**
```sql
grant select (id, business_id, name, description, price_minor, is_available, position)
  on public.menu_items to anon, authenticated;
create policy menu_items_select_public on public.menu_items for select to anon, authenticated
  using ((select private.business_is_public(business_id)));
create policy menu_items_select_own on public.menu_items for select to authenticated
  using ((select private.owns_business(business_id)));
-- No insert/update/delete grants or policies: writes only through the functions below.
```

**`business_photos`:**
```sql
grant select (id, business_id, kind, menu_item_id, path, position)
  on public.business_photos to anon, authenticated;
create policy business_photos_select_public on public.business_photos for select to anon, authenticated
  using (status = 'ready' and (select private.business_is_public(business_id)));
create policy business_photos_select_own on public.business_photos for select to authenticated
  using ((select private.owns_business(business_id)));
-- status and created_at are not granted; the owner sees only rows the app created and finished.
```
`path` starts with `business_id`, never the owner's user id, so a public photo can't link a listing to an account. This keeps spec 05's rule that `owner_id` is never public (Decision 10).

**`storage_cleanup_queue`:** no grants and no policies. Only the functions touch it.

**Field ownership:**

| Data | Seller can set | How |
|---|---|---|
| `businesses.currency_code` | while no item has a price | `set_menu_currency()` |
| item `name`, `description`, `price_minor`, `is_available` | any time | `create_menu_item()` / `update_menu_item()` |
| item `position` | by moving one step | `move_menu_item()`; positions stay 1..n with no gaps (delete compacts them) |
| item `id`, `business_id`, `created_at` | never | server |
| photo `path`, `status`, `position`, `created_at` | never directly | `begin_photo_upload()` / `finish_photo_upload()` / `delete_business_photo()` |

### Functions
All functions are `security definer` with `set search_path = ''`. Each runs `revoke execute … from public, anon, authenticated` followed by `grant execute … to authenticated`. Owner = `auth.uid()`. No function takes a business id: each finds the caller's own business and raises `no_business` if there is none. Any item or photo id that isn't the caller's raises `not_found`, with no difference between "missing" and "someone else's". One exception, by design: `begin_photo_upload`'s `p_menu_item_id` is an input check, so a missing or someone else's item there raises `invalid_input` (still the same error for both).

| Function | Behaviour |
|---|---|
| `set_menu_currency(p_code text) returns void` | Locks the business. A null `p_code` → `invalid_input` (the currency can't be unset). If `p_code` differs from the current value and any item has a price → `prices_exist`. An unknown code → 23503. |
| `create_menu_item(p_name text, p_description text, p_price_minor integer, p_is_available boolean default true) returns uuid` | Locks the business. At 100 items → `item_limit`. A price with no currency → `currency_required`. Empty description → null. `position` = max + 1. |
| `update_menu_item(p_item_id uuid, p_name text, p_description text, p_price_minor integer, p_is_available boolean) returns void` | Locks the business. `not_found`, `currency_required`. Doesn't change position. |
| `move_menu_item(p_item_id uuid, p_direction text) returns void` | `'up'` / `'down'` swaps it with its neighbour (the deferred unique constraint allows the swap). At either end it does nothing. Anything else → `invalid_direction`. |
| `delete_menu_item(p_item_id uuid) returns void` | Deletes the item. Its photo row cascades and the trigger queues the file. Then closes the position gap. |
| `begin_photo_upload(p_kind text, p_menu_item_id uuid default null) returns jsonb` | Locks the business. First deletes this business's `pending` rows older than 1 hour (the trigger queues their paths). Then:<br>• gallery: ready + pending ≤ 6, else `photo_limit`<br>• menu: ready + pending ≤ 10, else `photo_limit`<br>• cover / item: one slot. A new reservation **replaces** any pending row for the same slot (the cover, or that item's photo): the old pending row is deleted and the trigger queues its file. So a failed upload can be retried at once. Never `photo_limit`. The ready photo is replaced only on finish.<br>Gallery and menu pending rows keep counting, so the app deletes a failed one right away with `delete_business_photo`; the 1-hour expiry is the backstop. `p_menu_item_id` must be the caller's item for `item` and null otherwise → `invalid_input` (missing and someone else's give the same error). Inserts a `pending` row and returns `{ photo_id, path }`. |
| `finish_photo_upload(p_photo_id uuid) returns jsonb` | The caller's `pending` row, otherwise `not_found`. The object must exist in `storage.objects` (bucket `business-media`, `name = path`), with `metadata->>'mimetype'` one of the allowed types and a size within the limit. Otherwise → `upload_missing`. Sets `ready` and the next `position` for gallery/menu. For cover/item, deletes the previous `ready` row in the same transaction, and the trigger queues its file. Returns the photo. |
| `delete_business_photo(p_photo_id uuid) returns void` | Deletes the caller's row, pending or ready. The trigger queues the file. Closes the position gap. |
| `claim_photo_cleanup() returns setof text` | For the caller's business: drops queue rows whose object no longer exists in `storage.objects`, then returns the queued paths whose object still exists. The app removes those through the Storage API. The server checks what's actually gone, so the app can't mark a file as removed by mistake. |
| `get_my_business()` / `business_owner_view(uuid)` | `create or replace`: adds `currency_code` to the owner view. Grants are unchanged. |

**Function allowlist (spec 05 test):** authenticated may execute exactly `claim_photo_cleanup`, `begin_photo_upload`, `create_menu_item`, `create_my_business`, `delete_business_photo`, `delete_menu_item`, `finish_photo_upload`, `get_my_business`, `move_menu_item`, `set_menu_currency`, `set_seller_mode` and `update_menu_item`. Anon executes no `public` function. A new check covers the `private` schema: its functions are exactly the five helpers above, all `security definer` with an empty `search_path`, and `private` is not in the API schemas.

No request status transitions in this spec.

## Storage
**Bucket `business-media`**, created in the migration (`insert into storage.buckets …`):
- `public = false`. Private, so photos disappear when seller mode is off (Decision 10; this changes the supabase-patterns note "business-media: public").
- `file_size_limit = 2 MB` (2 097 152 bytes; see "Image size" below).
- `allowed_mime_types = {image/jpeg, image/png, image/webp}`, as decided. The app always uploads JPEG, because re-encoding to JPEG is what strips the metadata (see Photo privacy).

**Path:** `<business_id>/<photo_id>.jpg`, generated by `begin_photo_upload`. The client never picks a path or a file name.

**Policies on `storage.objects`:**
```sql
create policy business_media_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'business-media'
              and (select private.photo_upload_allowed(name)));     -- pending row, caller's business, < 1 h
create policy business_media_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'business-media'
         and ((select private.photo_is_public(name))
              or (select private.owns_business(((storage.foldername(name))[1])::uuid))));
create policy business_media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'business-media'
         and (select private.owns_business(((storage.foldername(name))[1])::uuid))
         and not (select private.photo_is_live(name)));            -- only files whose row is gone
-- No update policy: files are never overwritten (no upsert). Replace = new path + delete the old one.
```
Together these mean:
- An object can only be written at a path the server reserved, inside the caller's business folder.
- The number of objects is capped by the photo-row limits, because every insert needs its own pending row and every row has one fixed path.
- A seller can't delete another business's files, or their own live ones.
- The `::uuid` cast on a malformed folder name must fail closed. A test covers that.

**Image size (Decision 14):**

| Setting | Value | Where it's enforced |
|---|---|---|
| Maximum size in pixels | long edge **1600 px**; the short edge scales to keep the aspect ratio; smaller images are never upscaled | app, `prepareImage` |
| JPEG quality | **0.8**; one retry at **0.6** if the output is over the byte limit | app, `prepareImage` |
| Byte limit | **2 MB (2 097 152 bytes)** per file. Output is typically 0.3–0.8 MB | bucket `file_size_limit` (Storage API rejects larger), `finish_photo_upload` (checks `metadata->>'size'`), and the app (checks before upload) |
| Allowed types | JPEG, PNG, WebP in the bucket; the app always uploads JPEG | bucket `allowed_mime_types`, `finish_photo_upload` |

**Reading, signed URLs and caching (Decision 15):**
- **Getting URLs:** `createSignedUrls(paths, 3600)`, one batch per screen, through `useSignedUrls`. It needs the select policy, so anon gets URLs only for public photos.
- **Expiry and renewal:**
  - URLs last **1 hour**. The query has `staleTime` 50 minutes, so react-query fetches new URLs before the old ones expire whenever the screen is used after that (on mount, focus, or when new paths appear).
  - `gcTime` is 55 minutes, so an unused set of URLs is never handed out after expiry.
  - **Expired or refused URL anyway** (phone asleep, clock skew, seller mode switched off): `PhotoTile`'s `onError` calls `renew()`, which invalidates that screen's signed-URL query **once per path per mount**. If the new request fails or returns no URL for the path (the photo is no longer public), the tile shows its failed state ("Photo unavailable") instead of retrying in a loop.
- **Caching is keyed by path, not URL:**
  - `PhotoTile` renders `expo-image` with `source={{ uri: signedUrl, cacheKey: path }}` and `cachePolicy="memory-disk"`.
  - A renewed URL for the same path hits the same cache entry, so a photo already on the phone shows straight away, with no reload and no flash.
  - The path is unique per photo (`<business_id>/<photo_id>.jpg`, never reused). A replaced photo has a new path, so the cache can never show the old image under the new photo.
- **Known limits:**
  - A signed URL issued before seller mode was switched off still works until it expires, at most 1 hour.
  - A photo already in a viewer's disk cache stays on that phone until the cache evicts it. The app stops showing it as soon as the rows are no longer readable, because no path, no tile.
  - The app doesn't log signed URLs.
  - **Content type is declared, not verified:** Storage checks the content type the uploader declares (and `finish_photo_upload` checks the `mimetype` Storage recorded from it), not the actual bytes. A client that skips the app could store a non-image file under a reserved path, within the 2 MB limit and the photo-row caps. Not mitigated in v1; the server-side check in v1.md §16 (Decision 13) would cover it.

**No orphaned files (Decision 6):** a database transaction and a Storage API call can't be one atomic step. So deletes use an **outbox**:
1. Every path that loses its row (delete item, delete photo, replaced cover or item photo, expired pending reservation, business cascade) is written to `storage_cleanup_queue` by a trigger, **in the same transaction** as the delete. No file is ever forgotten.
2. After any delete or replace, and when the Menu or Photos screen opens, the app calls `claim_photo_cleanup()`, removes the returned paths through the Storage API, and calls it again so the server drops the rows that are now gone.
3. A failed removal stays queued and is retried next time.
4. The order is always "row first, file later". The worst case is a file waiting in the queue, never a live row pointing to a missing file.
5. **Gap:** if a seller never opens the app again, queued files stay until a server-side sweeper exists. The sweeper is not built in v1. It is tracked in `docs/product/v1.md` §16 together with account deletion, which must also remove the account's files (Decision 13).

## Edge Functions
None. A server-side metadata check is not in v1 (Decision 13; tracked in v1.md §16).

## Components & hooks
**Shared media (`src/features/media/`, reused by spec 13; nothing seller-specific):**
- `pickImage.ts`: `pickImage()` wraps `expo-image-picker` `launchImageLibraryAsync`:
  - images only, single selection (v1.md §3: one photo per upload), `exif: false`, no in-picker editing;
  - returns the asset URI or `null` on cancel;
  - photo library only (no camera, so no camera permission).
- `prepareImage.ts`: `prepareImage(uri, opts?)`:
  1. **Resize** with `expo-image-manipulator` to a long edge of at most 1600 px. Never upscale.
  2. **Re-encode** as JPEG at quality 0.8. Re-encoding writes a new file without the source's EXIF/XMP/IPTC.
  3. Read the output bytes (`expo-file-system`) and run `assertNoHiddenMetadata(bytes)`.
  4. If the output is over 2 MB, re-encode once at 0.6. Still over → `MediaError('too_large')`.

  It returns `{ uri, bytes, width, height, mimeType: 'image/jpeg' }`. The upload always sends **these bytes**, never the picker's original file.
- `jpegMetadata.ts`: `assertNoHiddenMetadata(bytes)` is a pure function. It walks the JPEG markers from SOI to SOS:
  - **Allowed:** APP0 (JFIF), APP2 (ICC colour profile), APP14 (Adobe), and the image segments.
  - **Rejected:** APP1 (EXIF and XMP: where GPS lives), APP13 (IPTC/Photoshop), any other APPn, COM comments, and anything that isn't a valid JPEG.

  On a rejection it throws `MediaError('metadata_present')`, and the upload is cancelled.
- `api.ts`: `uploadToBucket(bucket, path, bytes)` (upsert false), `removeFromBucket(bucket, paths)` and `signedUrls(bucket, paths, ttl)`. These are all of the Storage calls.
- `MediaError` codes: `'cancelled' | 'too_large' | 'metadata_present' | 'not_an_image' | 'upload_failed' | 'network' | 'unknown'`, with `mediaErrorMessage(code)`.
- `components/PhotoTile.tsx`:
  - An `expo-image` thumbnail with `source={{ uri, cacheKey: path }}`, `cachePolicy="memory-disk"` and an `accessibilityLabel`.
  - States: loading, loaded, and failed ("Photo unavailable", after one renewal attempt).
  - `onError` calls `onExpired(path)` once per path per mount.
  - In edit mode it is a ≥ 44pt button with an action label.
- `components/AddPhotoButton.tsx`: a ≥ 44pt button with a "Uploading…" state; it is disabled with a reason when full.
- `hooks/useSignedUrls.ts`:
  - `useSignedUrls(bucket, paths)`, key `['media','signed', bucket, ...sortedPaths]`.
  - `staleTime` 50 minutes, `gcTime` 55 minutes, TTL 3600 s.
  - Returns `{ urlFor(path), renew(path) }`. `renew` invalidates the query at most once per path per mount.

**Menu feature (`src/features/menu/`):**
- `schema.ts`: `Currency`, `MenuItem`, `BusinessPhoto`, and the item form. Name trimmed 1–80; description ≤ 300, blank → null; price as text parsed per currency.
- `price.ts` (pure):
  - `parsePrice(text, minorUnits)` → integer minor units or an error. It takes a `.` or `,` separator, rejects more decimals than `minorUnits`, uses string maths only, and enforces 1..999 999 999.
  - `formatPrice(minor, currency, minorUnits, locale)`.
  - `formatPriceInput(minor, minorUnits)`, to pre-fill the edit form.
- `api.ts`:
  - `getCurrencies()`
  - `getMenu(businessId)`: items ordered by position, plus photos. Owner and guests use the same query; RLS decides.
  - `setMenuCurrency`, `createMenuItem`, `updateMenuItem`, `moveMenuItem`, `deleteMenuItem`
  - `beginPhotoUpload`, `finishPhotoUpload`, `deleteBusinessPhoto`, `claimPhotoCleanup`
  - `MenuAppError` codes: `'no_business' | 'item_limit' | 'photo_limit' | 'currency_required' | 'prices_exist' | 'not_found' | 'upload_missing' | 'invalid_input' | 'network' | 'unknown'`, with `mapMenuError`, following `mapSellerError`.
- `uploadBusinessPhoto.ts`: orchestrates the steps `prepareImage` → `beginPhotoUpload` → `uploadToBucket` → `finishPhotoUpload`. If the upload or finish fails, it calls `deleteBusinessPhoto(photo_id)` and then runs cleanup.
- `hooks/`:
  - `useCurrencies` (key `['currencies']`, `staleTime: Infinity`)
  - `useMyMenu` (key `['menu', businessId]`)
  - `useMenuItemMutations` (create/update/move/delete): optimistic move with rollback; on success, invalidate `['menu', id]`
  - `useUploadBusinessPhoto`, `useDeleteBusinessPhoto`
  - `usePhotoCleanup`: runs after any delete or replace, and on mount of the Menu and Photos screens
  - `useSuggestedCurrency` (`expo-localization`)
- `components/`: `MenuScreen.tsx`, `MenuItemRow.tsx`, `MenuItemFormScreen.tsx`, `BusinessPhotosScreen.tsx`, `CurrencyPicker.tsx` (searchable modal like `CuisinePicker`; rows are radios labelled "Canadian dollar, CAD"), `PriceField.tsx`.

**Sellers (changes):** `sellerRoutes.ts` adds the three screen kinds. `ManageBusinessScreen` adds the Menu and Photos rows. `schema.ts` `MyBusiness` adds `currency_code`.

**Accessible names for photos (Decision 16):** photos are named by the business or item name. There are no seller-written descriptions in v1; optional descriptions may come later.
- cover: "Cover photo, <business name>"
- gallery: "Photo 2 of 6, <business name>"
- menu photo: "Menu page 3 of 10, <business name>"
- item photo: "Photo of <item name>"
- In edit mode the tile is a button: "Gallery photo 2 of 6. Opens photo options." with `accessibilityRole="button"`.

Menu photos are pictures of text that screen readers can't read; the hint on the Photos screen suggests also adding items.

**Move controls:** "Move <item name> up" / "Move <item name> down", `accessibilityRole="button"`. The first item's "up" and the last item's "down" are disabled (`accessibilityState.disabled`). After a move, focus stays on the moved item's button and a short announcement says "<name> moved to position 3 of 12" (`AccessibilityInfo.announceForAccessibility`).

## Files to create
- `supabase/migrations/<timestamp>_menu_management.sql`
- `supabase/tests/06-menu-management.test.sql`
- `src/features/media/` (`pickImage.ts`, `prepareImage.ts`, `jpegMetadata.ts`, `api.ts`, `errors.ts`, `components/`, `hooks/`, `__tests__/` + `__tests__/fixtures/` with small JPEGs: one with EXIF GPS, one with XMP GPS, one clean)
- `src/features/menu/` (schema, `price.ts`, api, `uploadBusinessPhoto.ts`, hooks, components above, `__tests__/`)
- `app/seller/menu/index.tsx`, `app/seller/menu/new.tsx`, `app/seller/menu/[itemId].tsx`, `app/seller/photos.tsx`

## Files to change
- `supabase/tests/05-seller-onboarding.test.sql`: add `currency_code` to the exact `businesses` column privileges and to the `get_my_business` shape; extend the function allowlist.
- `supabase/tests/03-navigation-shell.test.sql`: add `currencies`, `menu_items` and `business_photos` to the ALLOWLIST.
- `supabase/config.toml`: no bucket block (the migration creates it, so local and remote match). Confirm `private` is not in `[api] schemas`.
- `.github/workflows/ci.yml`: **only if needed.** CI runs `supabase db start` (database only). If `storage.buckets`, `storage.objects`, `storage.foldername` or the storage triggers the migration and tests rely on aren't present without the Storage service, start it (`supabase start -x` with everything else excluded). This is checked at Gate A (see Rules).
- `app/seller/_layout.tsx`: titles for "Menu", "Add item", "Edit item", "Photos".
- `src/features/sellers/sellerRoutes.ts`, `schema.ts`, `components/ManageBusinessScreen.tsx` (+ tests).
- `app.config.ts`: the `expo-image-picker` config plugin, with the photo-library text "LikeToOrder uses your photos to add pictures to your menu and listing." and `cameraPermission: false`, `microphonePermission: false`.
- `jest.setup.ts`: mocks for `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, `expo-localization`, `expo-image`.
- `src/types/database.ts`: regenerate with `npm run db:types`.
- `.claude/skills/supabase-patterns/SKILL.md`, Storage section:
  - `business-media` is **private**, path `<business_id>/<photo_id>.jpg`, signed URLs;
  - the reserve → upload → finish pattern;
  - the cleanup outbox;
  - the `private` helper schema for cross-table policies.
- `CLAUDE.md`: add `media` to the feature-folder list. In Supabase rules, reword the storage line to "users write only inside their own folder: `<auth.uid()>/…` or, for business media, `<business_id>/…` of a business they own".
- `docs/product/v1.md`, when spec 06 ships (PR 2):
  - Update the §5 Menus item fields to "name, optional description, optional price, optional photo, available yes/no" (Decision 20).
  - Add the spec 06 shipped changelog line, noting the §5 change.

  The two §16 items from Decision 13 were already added with the spec review decisions on 2026-11-03.

## New dependencies
Install with `npx expo install`, so the versions match the Expo SDK:
- `expo-image-picker`: pick one photo from the library.
- `expo-image-manipulator`: resize and re-encode to JPEG, which drops EXIF/GPS.
- `expo-image`: display with caching (in the CLAUDE.md stack, not installed yet).
- `expo-file-system`: read the processed file's bytes for the metadata check and the upload body.
- `expo-localization`: the phone's currency code for the suggestion, and the locale for price formatting.

No camera, no `expo-location`, no image editing library.

## Rules for implementation
Always include:
- RLS on every new table + pgTAP test
- Supabase calls only in `src/features/<x>/api.ts` (Storage calls only in `src/features/media/api.ts`)
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility labels on every touchable

Feature-specific rules:
- **Revoke-then-grant** for all four tables in the same migration. Column grants exactly as listed. No insert/update/delete grants on `menu_items` or `business_photos`.
- **Every write goes through a function that locks the business row.** Limits, currency rules and positions are never checked only in the app.
- **Every callable function** ends with `revoke execute … from public, anon, authenticated` and then its grant, and is added to the allowlist test. Private helpers live in `private`, never `public`.
- **Owner identity comes from `auth.uid()`.** No function takes a business id from the client.
- **Paths are server-made** (`<business_id>/<photo_id>.jpg`). Never a user id in a public path. Never a client-chosen name.
- **Every photo goes through `prepareImage`**, and the upload sends its output bytes only. The picker's original file is never uploaded. No code path skips `assertNoHiddenMetadata`.
- **Do not log** photo bytes, URIs, paths or signed URLs.
- **Row first, file later.** Never remove a file before its row is gone. Never write a row pointing at a file that doesn't exist (`finish_photo_upload` checks).
- **Prices are integers** in minor units end to end. No `parseFloat` or float maths on money.
- **Never unmount the Stack while loading** (Decision 14). Menu screens redirect only after `useMyBusiness` loads, via `SellerScreenGate`.
- **Spec 04 display rule** wherever a cuisine appears (the Manage Business header already uses `CuisineLabel`).
- **Storage in CI (Gate A check):** run `npx supabase test db` against the database-only start used by CI (`npx supabase stop && npx supabase db start && npx supabase db reset`). If the storage schema the migration needs is missing there, change the CI step to start Storage too, and call it out in the PR. pgTAP delete tests on `storage.objects` may need the storage delete-protection setting for direct SQL deletes. Confirm the mechanism in planning.

### Stage gates
Stop at each gate. Run the gate's checks, report, and commit (conventional commit, files staged by name) before going on. Each gate needs Archan's go-ahead.

| Gate | PR | Contents | Checks before stopping |
|---|---|---|---|
| **A** | 1 | Migration (schema, currencies seed, bucket, storage policies, functions, triggers), `06-menu-management.test.sql`, the 05 and 03 test updates, regenerated `database.ts`, supabase-patterns + CLAUDE.md wording, any CI storage change | `npx supabase db reset`, `npx supabase test db` (all files), the database-only check above, `npm run typecheck` |
| **B** | 2 | `src/features/media/**` with its jest tests and fixtures, the five dependencies, `app.config.ts` plugin, `jest.setup.ts` mocks | `npm run lint`, `npm run typecheck`, `npm test` |
| **C** | 2 | `src/features/menu/**` (no tests yet), `app/seller/menu/*`, `app/seller/photos.tsx`, seller changes | `npm run lint`, `npm run typecheck`, existing `npm test` green |
| **D** | 2 | Jest tests from this spec (`/test-feature`: writer, then runner) | `npm test` plus every check from A–C |
| **Manual** | 2 | The device run in the Test plan | Archan |

## Out of scope
- Showing menus or photos to customers in any UI: the map and bottom sheet (specs 07, 08). This spec only grants the read access.
- Ordering from a menu and pickup/table requests (09+).
- Sections or categories, item options or modifiers, dietary or allergen tags.
- More than one currency per business; currency conversion; taxes.
- Bulk import, menu OCR, copying menus between businesses.
- Image editing beyond resize (crop, filters, rotate UI); camera capture; multi-select upload (v1.md §3).
- Reordering photos.
- Seller-written photo descriptions (Decision 16).
- Spec 13's uses of the shared media code (food log, profile photo).
- A server-side metadata check and an abandoned-files sweeper (Decision 13; both tracked in v1.md §16).
- Anything in `docs/product/v1.md` §3.

## Definition of done

**Database and security (pgTAP) — PR 1**
- [ ] RLS is on for `currencies`, `menu_items`, `business_photos` and `storage_cleanup_queue`. `00_rls_enabled` still passes.
- [ ] Exact privileges:
  - `anon` and `authenticated` hold no table-level privileges on the four new tables.
  - Column `select` is exactly as listed for `menu_items` and `business_photos`, with no insert/update/delete.
  - Nothing at all on `storage_cleanup_queue`.
  - `businesses` column privileges now include `currency_code` for select only.
- [ ] An outsider (anon or another signed-in user) sees no `menu_items` or `business_photos` of an unlisted or location-less business, and sees no `pending` photo of any business.
- [ ] Anon and other users can read a listed business's unavailable items, with `is_available = false` (Decision 19).
- [ ] An outsider cannot create, update, move or delete another business's items or photos: every function acts only on the caller's business, and another business's item/photo id gives `not_found`.
- [ ] A direct `insert`/`update`/`delete` on `menu_items` or `business_photos` by authenticated fails (42501).
- [ ] Switching seller mode off makes the business's items and photos (rows and storage objects) unreadable by anon and by other users. Switching it on restores them. The owner reads them in both states.
- [ ] `create_menu_item` raises `item_limit` on the 101st item and `currency_required` for a price with no currency.
- [ ] `set_menu_currency` raises `prices_exist` once any item has a price, and succeeds again after the prices are removed.
- [ ] `move_menu_item` swaps neighbours, does nothing at the ends and keeps positions 1..n. Delete closes the gap.
- [ ] `begin_photo_upload` raises `photo_limit` for the 7th gallery photo and the 11th menu photo, counting pending rows. Pending rows older than 1 hour don't count and are queued for cleanup.
- [ ] A second `begin_photo_upload` for the cover, or for the same item, replaces the pending reservation: the old pending row is gone, its path is queued, the new reservation can be uploaded to and finished at once, and the old path can no longer be uploaded to.
- [ ] Deleting a pending gallery or menu photo with `delete_business_photo` frees its slot at once and queues its path; `claim_photo_cleanup` then drops the queue row if no file was uploaded.
- [ ] `begin_photo_upload` raises `invalid_input` for a missing or someone else's item id, and `set_menu_currency(null)` raises `invalid_input`.
- [ ] `finish_photo_upload` raises `upload_missing` when no object exists at the path, or when its mimetype isn't allowed.
- [ ] Replacing a cover or item photo leaves exactly one `ready` row and queues the old path in the same transaction.
- [ ] Deleting an item, a photo, the whole business, or the owner's account (cascade) queues every affected path.
- [ ] A reservation 59 minutes old can still be uploaded to and finished. `claim_photo_cleanup` drops queue rows whose object is gone and returns only the caller's still-present paths.
- [ ] Storage, `business-media`:
  - The bucket is private, with a 2 MB limit and exactly JPEG/PNG/WebP.
  - An owner can insert only at a path reserved by a fresh pending row of their own business.
  - Inserting into another business's folder, at another user's reserved path, at an unreserved path, at a path whose photo is already ready, at an expired reservation's path, or at a malformed path (folder not a UUID) fails. A malformed folder name fails closed: refused or no access, never an error that lets anything through.
  - Anon can read only ready objects of public businesses.
  - An owner cannot delete a live object; an outsider cannot delete any.
  - There is no update policy.
- [ ] The function allowlist is exactly the 12 names listed for authenticated, none for anon. The `private` schema holds exactly the five helpers and isn't exposed by the API.
- [ ] `currencies` minor units: JPY, KRW, VND, CLP and ISK = 0; USD, CAD and EUR = 2; BHD, KWD, JOD, OMR, TND and IQD = 3. No code has 4 decimals. Clients can't write the table.
- [ ] `get_my_business()` includes `currency_code`.
- [ ] 03 ALLOWLIST updated; `02`–`05` tests still pass.
- [ ] `src/types/database.ts` is regenerated. The supabase-patterns skill and CLAUDE.md storage wording are updated.
- [ ] `npx supabase test db` passes locally and in CI (with Storage started in CI if needed).

**Shared media (jest) — PR 2**
- [ ] `assertNoHiddenMetadata` rejects the EXIF-GPS fixture, the XMP-GPS fixture, an APP13 segment, a COM segment and non-JPEG bytes. It accepts the clean fixture and JFIF + ICC + Adobe segments.
- [ ] `prepareImage` resizes to a long edge ≤ 1600 px without upscaling and outputs JPEG. It runs the metadata check on the output bytes. It retries once at 0.6 when over 2 MB, then fails with `too_large`.
- [ ] The upload sends `prepareImage`'s bytes, never the picker URI (asserted in the orchestration test). A `metadata_present` result uploads nothing.
- [ ] `pickImage` asks for a single image from the library only, with `exif: false`, and returns `null` on cancel.
- [ ] `prepareImage` asks the manipulator for a long edge of exactly 1600 px for larger images (aspect ratio kept), leaves smaller images at their size, and encodes JPEG at 0.8. An output over 2 097 152 bytes is re-encoded at 0.6.
- [ ] `PhotoTile` passes `cacheKey` = the stored path and `cachePolicy="memory-disk"` to `expo-image`. When the signed URL for the same path changes, the `cacheKey` stays the same and the tile doesn't go back to its loading state.
- [ ] `useSignedUrls` asks for 3600 s URLs. It doesn't refetch before 50 minutes and fetches new URLs after 50 minutes on the next mount or focus (fake timers). `renew(path)` invalidates once per path per mount. A second error on the same path shows "Photo unavailable", with no loop.
- [ ] Nothing in `src/features/media/` imports seller or menu code.

**Menu app — PR 2**
- [ ] `parsePrice` and `formatPrice` handle 0, 2 and 3 decimal currencies; `.` and `,` input; too many decimals (error); and bounds. Examples: JPY "1200" → 1200 → "¥1,200" (en-US); EUR "12,50" → 1250 → "12,50 €" (de-DE); KWD "1.250" → 1250 → "KWD 1.250" (en-US). No float maths.
- [ ] The currency picker is pre-filled with the device currency when it's in the list, and has no pre-selection otherwise. It is read-only, with a reason, once a price exists.
- [ ] A seller adds, edits and deletes an item; toggles availability from the list; and moves items with up/down buttons. The list updates without a restart. Ends are disabled, and a move is announced.
- [ ] Item limit: "Add item" is disabled at 100 with a reason, and the server error `item_limit` shows a message.
- [ ] A seller adds, replaces and removes the cover and item photos, and adds and removes gallery and menu photos. Counts show "n of N", and Add is disabled when full.
- [ ] After a delete or replace, the cleanup runs and removes the returned paths. A failed removal is retried on the next screen open.
- [ ] The Menu, item and Photos screens redirect to onboarding for a user with no business only after the business loads. The Stack stays mounted while loading (routing test).
- [ ] Every new screen shows loading, error with retry, empty and success states.
- [ ] Photos have the accessible names listed. Every touchable has `accessibilityLabel` + `accessibilityRole` and is ≥ 44pt. "Unavailable" is shown as text, not color alone.
- [ ] The homemade photo note shows only for homemade sellers.
- [ ] No hardcoded colors or sizes outside tokens.
- [ ] Manual device run done (Test plan).
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:functions` and `npx supabase test db` all pass, in CI too.
- [ ] CLAUDE.md row 06 and this spec's status are ✅ Shipped. v1.md §5 lists the item fields with the optional description, and the changelog has a spec 06 shipped line that notes the §5 change (Decision 20).

## Test plan
**Database tests (pgTAP)**: `supabase/tests/06-menu-management.test.sql`, using the spec 05 impersonation pattern (fixed UUIDs `…0601`–`…06xx`: listed restaurant owner, listed homemade owner, unlisted owner, owner with no location, outsider, user with no business, anon).
- RLS flags, exact `table_privs_are` / `column_privs_are` on all four tables (every column, anon and authenticated) and on `businesses.currency_code`.
- Retry: a second cover/item reservation replaces the pending one and can be uploaded and finished at once. Deleting a pending gallery photo frees the slot.
- Owner vs. outsider vs. anon for each function and each select policy; direct write attempts (42501).
- Limits (items, each photo kind), the currency lock, move/delete position invariants.
- Pending expiry: backdate `created_at` as the superuser inside the test, then check the limit ignores the row and it's queued.
- Expiry boundary: a reservation backdated to 59 minutes can still be uploaded to and finished (and still counts toward the limit).
- Account deletion: deleting the owner's `auth.users` row (cascade: profile → business → items and photos) leaves every one of the business's photo paths (cover, gallery, menu, item; pending and ready) in `storage_cleanup_queue`.
- Storage: as each role, `insert into storage.objects (bucket_id, name, …)` for reserved, unreserved, other-business, expired and malformed paths. `select` visibility before and after `set_seller_mode(false)`. `delete` of live vs. queued objects. The bucket row's `public`, `file_size_limit` and `allowed_mime_types`.
- `finish_photo_upload` with and without an object row (and with a disallowed mimetype in `metadata`).
- Cleanup queue contents after item delete, photo delete, replace and business cascade; `claim_photo_cleanup` behaviour.
- `currencies` minor-unit samples and write refusal; the function allowlist and `private` checks (in the 05 file, which owns the allowlist).

**Unit and component tests (jest)**: supabase and native modules mocked. All RNTL v14 calls are awaited.
- `media/__tests__/jpegMetadata.test.ts`: the committed fixtures plus hand-built byte arrays for each marker case.
- `media/__tests__/prepareImage.test.ts`: manipulator options, no upscaling, the size retry, the check on output bytes.
- `media/__tests__/pickImage.test.ts`, `media/__tests__/api.test.ts` (upsert false, batch signed URLs with TTL 3600).
- `media/__tests__/useSignedUrls.test.tsx`: fake timers. No refetch at 49 minutes, a refetch at 51 minutes on remount/focus, the key is independent of path order, and `renew` invalidates once per path per mount.
- `media/__tests__/PhotoTile.test.tsx`:
  - `expo-image` mocked to capture props: `cacheKey` equals the path, and stays the same when the `uri` changes for the same path.
  - `onError` calls `onExpired` once; a second error shows the failed state.
  - Accessible label and role in view and edit modes.
- `menu/__tests__/price.test.ts`: a table of currency × locale × input cases.
- `menu/__tests__/api.test.ts`: RPC names and arguments, error mapping for every `MenuAppError` code.
- `menu/__tests__/uploadBusinessPhoto.test.ts`: the step order; on failure it deletes the pending row and runs cleanup; it never uploads the original URI.
- `menu/__tests__/MenuScreen.test.tsx`, `MenuItemFormScreen.test.tsx`, `BusinessPhotosScreen.test.tsx`, `CurrencyPicker.test.tsx`: the 4 states, limits, move controls and announcements, the currency lock, accessible names, the homemade note.
- `sellers/__tests__/sellerRoutes.test.ts` (new rows), `sellerRouting.test.tsx`: push `/seller/menu` while `getMyBusiness` is pending. The mount counter doesn't increase and the skeleton is visible. Then resolve `null` → `/seller/onboarding`, and Back still returns to the previous screen.
- `sellers/__tests__/ManageBusinessScreen.test.tsx`: the Menu and Photos rows and their summaries.

**Manual check on device (iOS and Android)**:
- **Metadata stripped:** with location on in the camera, take a photo, then upload it as a homemade gallery photo. In Studio, download the stored object and run `exiftool` on it: no GPS, no EXIF block. Do the same for an item photo.
- Add items with prices in CAD; try JPY and KWD on a test business to check the decimals; check the currency lock.
- Reorder with VoiceOver/TalkBack using the up/down buttons and hear the announcement.
- Fill each photo section to its limit; replace the cover; delete an item with a photo, then check in Studio that the file is gone after the screen reopens.
- Seller mode off: a signed URL request for a new URL fails for another account.
- **Cache by path:** open the Photos screen, wait more than 50 minutes (or lower the TTL in a local build), then reopen it. New URLs are fetched (visible in the network log) and the photos show at once, with no reload or flash.

## Decisions (from Archan, 2026-11-03)
1. **Menu layout:** one ordered list of items per business, no sections. Itemized items, menu photos, or both. Items: name (required), optional description, optional price, optional single photo, available yes/no. Reordering is accessible (up/down controls, not drag-only).
2. **Prices:** optional and global, not CAD-only. Design approved in Decision 12.
3. **Photos:** Supabase Storage with bucket policies. 1 cover, up to 6 gallery, up to 10 menu photos, 1 per item, enforced in the database and storage policies. Bucket size and type limits (JPEG/PNG/WebP). Public read only while the business is listed. Only the owner writes, only inside their business's folder. pgTAP for storage policies.
4. **Photo privacy:** resize on the phone and strip EXIF/location before upload; propose a test; say honestly whether the server can verify it (see Decision 13).
5. **Shared media pieces** in a shared folder for spec 13; spec 13's uses are not built here.
6. **No orphaned files** when an item or photo is deleted; say how; propose a maximum item count.
7. **Accessible photo names:** propose the simplest approach (see Decision 16).
8. **Scope:** menu management inside Manage Business, plus read-only data access for later specs; out-of-scope list as given.
9. **Follow** the revoke-then-grant rules, Decision 14 routing and the spec 04 display rule. Split into two PRs with stage gates if large.

### Spec review decisions (approved 2026-11-03)
10. **The three deviations are accepted:**
    - **Storage path** `<business_id>/<photo_id>.jpg`, not `<auth.uid()>/…`. A user id in a public photo URL would link the listing to an account, which spec 05 prevents. The CLAUDE.md storage wording is updated at Gate A to allow "a business folder you own".
    - **`business-media` is a private bucket with signed URLs**, not public as supabase-patterns said, so photos disappear when seller mode is off.
    - **One photo per upload (v1.md §3):** gallery and menu photos are each picked and uploaded on their own. The picker is single-select.
11. **Two PRs (Q1):** PR 1 = Gate A (database and storage) on `feature/menu-management`. PR 2 = Gates B–D + manual run on `feature/menu-management-app`, created from `main` after PR 1 is merged. The Definition of done tags each group with its PR.
    - **When PR 1 ships:** `/ship-feature` ticks only the PR 1 items, sets this spec's status and CLAUDE.md row 06 to 🚧 In progress (never ✅), and adds no "shipped" changelog line.
    - **When PR 2 ships:** it ticks the rest and sets ✅ Shipped.
12. **Currency approved as designed (Q2):**
    - one ISO 4217 currency per business;
    - integer minor units with 0/2/3 decimals from `currencies.minor_units`;
    - formatted with the viewer's locale and exactly the ISO decimals;
    - the suggestion comes from the phone's currency, and the seller confirms it the first time a price is entered;
    - no change while any item has a price (`prices_exist`).

    The "clear all prices" alternative is **not** built.
13. **No server-side metadata check and no sweeper in v1 (Q3, Q5).** Added to `docs/product/v1.md` §16:
    - (a) a server-side photo metadata check, to consider before launch;
    - (b) an abandoned-files sweeper, recorded with the account-deletion item, which now says that deleting an account must also remove its files.
14. **Image size:** long edge at most 1600 px (no upscaling), JPEG quality 0.8 with one retry at 0.6, and a 2 MB (2 097 152 bytes) bucket limit, also checked by `finish_photo_upload` and by the app before upload. See the "Image size" table.
15. **Image caching by path:** `expo-image` caches by the stored path (`cacheKey: path`), never by the signed URL, so a renewed link doesn't reload a photo. URL expiry and renewal work as described under "Reading, signed URLs and caching", with jest tests and a manual check.
16. **Accessible photo names (Q7):** photos are named for screen readers by the business or item name for now. Optional seller-written descriptions may come later.

### Open question answers (approved 2026-11-03)
17. **Limits (Q4):** at most 100 menu items per business. An unfinished photo upload (a `pending` row) expires after 1 hour, stops counting against the photo limits, and is queued for cleanup.
18. **Homemade photo hint (Q6):** homemade sellers only, on the Photos screen: "Photos are public. Avoid showing your house number, front door or street sign." Restaurants don't see it.
19. **Unavailable items (Q8):** unavailable items stay readable by everyone (the public select policy doesn't filter on `is_available`). Wherever they are shown, "Unavailable" is text, never colour alone.
20. **Item description in the product spec (Q9):** when spec 06 ships, update `docs/product/v1.md` §5 to list "name, optional description, optional price, optional photo, available yes/no", with a changelog note.

### Gate A1 review decisions (approved 2026-11-04)
21. **Malformed folder names fail closed:** the storage select/delete policies check the folder is a UUID before casting, so a bad name means "no access", never an error.
22. **`invalid_input` for a missing or someone else's item in `begin_photo_upload`**, as in the function table; the general `not_found` rule notes the exception.
23. **`set_menu_currency(null)` raises `invalid_input`.**
24. **Retry for cover and item photos:** a new reservation replaces the pending one for the same slot (second migration, `photo_slot_retry`). Gallery and menu pending rows keep counting; the app deletes a failed one at once, and the 1-hour expiry is the backstop.

### Design choices also accepted with the spec
- All menu and photo writes go through functions that lock the business row, not direct table writes. This is the only race-free way to enforce the limits and the currency lock.

## Open questions
None. All resolved on 2026-11-03, kept for the record:

1. ~~**Two PRs?**~~ → Decision 11.
2. ~~**Currency design.**~~ → Decision 12.
3. ~~**Server-side metadata check.**~~ → Decision 13 (not in v1; v1.md §16).
4. ~~**Limits** (100 items, 1-hour expiry of unfinished uploads).~~ → Decision 17.
5. ~~**Abandoned-files sweeper.**~~ → Decision 13 (not in v1; v1.md §16 with account deletion).
6. ~~**Homemade photo hint.**~~ → Decision 18 (wording changed).
7. ~~**Photo descriptions.**~~ → Decision 16.
8. ~~**Unavailable items for guests.**~~ → Decision 19 (readable by everyone).
9. ~~**Item description in the product spec.**~~ → Decision 20 (update §5 at ship).
