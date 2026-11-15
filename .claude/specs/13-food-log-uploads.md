# Spec 13: Food Log Uploads

**Branch:** `feature/food-log-uploads`. Two PRs from this one spec, same pattern as specs 09 to 12 (Decision 14):
- PR 1 (backend: migration, bucket, storage policies, functions, pgTAP, types, skill and docs): `feature/food-log-uploads-backend` (this branch, renamed before its first push)
- PR 2 (the app: feature code, routes, Profile row, permission text, jest tests, Simulator run): `feature/food-log-uploads-app`, created from `main` after PR 1 is merged
**Product spec:** `docs/product/v1.md` §2 (food log uploads in v1), §3 (out of scope: feed, follows, tagging restaurants, multi-photo), §11 (Profile; Food log uploads; Shared rules: local date, private uploads), §14 row 13, §15 Q3 and Q4, §16 (account deletion and files, server-side photo metadata check, storage use, photo sources across phones, hidden-character class S2, lists are paginated, flaky-test and test-client notes)
**Plan mode:** required — new table with RLS, a new storage bucket and storage policies, new security-definer functions and `private` helpers, new routes, a native setting change (photo-library text), well over ~5 files.
**Status:** 📝 Spec written

## Overview
After this ships, any signed-in person with a finished profile, customer or seller alike, keeps a personal **food log**. They pick one photo from their phone's library, add an optional short description, choose the photo's **cuisine/country** (required, the same list as the map flags) and choose **public or private** (public by default). The server sets the time of the upload and the person's **local date** at that moment; nothing can be backdated. Every upload has its own **detail page** (full image, full description, flag, date) where the owner can change the description, cuisine and visibility, or delete it. The owner sees their uploads newest first, 50 at a time, from a **Food log** row on Profile.

The photo is resized on the phone, and every piece of hidden metadata (EXIF, including GPS location) is removed before upload, with the same strict check as spec 06. Photos sit in a private bucket and are served by short-lived signed URLs. A private upload is readable only by its owner. A public one is readable by any signed-in user, never by guests, but in this spec nobody else has a screen that reaches it yet (Decision 3). The database enforces every limit and every ownership rule.

**Why now:** the request work (09 to 12) is done, and the activity grid (14, 15) needs uploads with `local_date`, `cuisine_code` and `is_public` to exist. The shared media code from spec 06 is ready for reuse.

## Depends on
- 02 auth-and-profiles ✅ (`profiles`, the profile-complete guard)
- 03 navigation-shell ✅ (Profile tab)
- 04 cuisine-catalog ✅ (`cuisines`, `CuisinePicker`, `CuisineLabel`, display rule)
- 06 menu-management ✅ (`src/features/media`, reserve → upload → finish, cleanup outbox, `private` helper schema, storage pgTAP)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §3, §11, §16
- This spec
- `.claude/skills/supabase-patterns/SKILL.md` (Storage, App api layer, pgTAP skeleton), `.claude/skills/liketoorder-ui/SKILL.md`
- **PR 1:** `supabase/migrations/20261104035153_menu_management.sql` (bucket at ~L670, private helpers ~L280-326, storage policies ~L675-698, `begin_photo_upload` / `finish_photo_upload` / `claim_photo_cleanup`), `20261104043659_photo_cleanup_limits.sql` (`cleanup_required`, 10-minute wait), `20261109021754_requests_answer_notes.sql` (`c_ctrl` / `c_edge` style, `is not distinct from` comment), `20261111172608_requests_filters.sql` or `20261110012046_table_requests.sql` (the `(created_at, id)` text cursor in `list_my_requests`); `supabase/tests/06-menu-management.test.sql` (storage fixtures, `pg_temp.put`, `allow_delete_query`), `05-seller-onboarding.test.sql` (function allowlist, private-schema list at ~L207-223), `03-navigation-shell.test.sql` (table allowlist), `11-table-requests.test.sql` (`pg_temp.as_user` style), `00_rls_enabled.test.sql`
- **PR 2:** `src/features/media/**` (not its tests), `src/features/menu/uploadBusinessPhoto.ts`, `src/features/menu/hooks/usePhotoMutations.ts`, `src/features/cuisines/components/{CuisineField,CuisinePicker,CuisineLabel}.tsx`, `src/features/profile/components/ProfileScreen.tsx`, `src/features/notifications/components/NotificationsRow.tsx` (row pattern), `src/components/ui/index.ts`, `src/theme/tokens.ts`, `src/features/requests/schema.ts` (`HIDDEN_RANGES`), `src/features/requests/hooks/usePagedRequests.ts` (paging pattern only), `app/_layout.tsx`, `app/profile/notifications.tsx`, `app.config.ts`, `jest.setup.ts`

## User stories
- As a signed-in person (customer or seller), I can add one food photo with an optional short description, a required cuisine and public or private, so that I keep a log of what I ate.
- As a person adding a photo, I know its hidden location data is removed before it leaves my phone.
- As a person, I can't backdate an upload: its time and day are set when I add it, by my own local day.
- As the owner, I can open an upload's detail page (full image, full description, flag, date), change its description, cuisine or visibility, or delete it.
- As the owner, I see my uploads newest first, 50 at a time, from Profile > Food log.
- As an outsider, I can't read another person's private upload, list anyone's uploads, change or delete them, or upload into their folder; as a guest I read nothing.
- As a screen-reader or large-text user, the form, the list, the detail page and the delete confirm all have labels, roles and state as words.

## Screens & routes
All new routes are under `app/food-log/`, behind the root layout's existing signed-in + profile-complete guard (the same as `app/profile/*`). Access: signed-in.

- `ProfileScreen` (change) — a **Food log** row (`NavRow`, the `NotificationsRow` pattern) after the header and Edit, before the seller-mode row. Value: none (no count in v1). → `/food-log`.
- `app/food-log/index.tsx` (new) — thin, renders `FoodLogListScreen`: **Add photo** button at the top, then my uploads newest first: square thumbnail, the cuisine through `CuisineLabel`, the date, a one-line trimmed description, and the word "Private" on private rows (text, not colour). Paged 50 at a time with infinite scroll. Tapping a row → the detail.
- `app/food-log/new.tsx` (new) — thin, renders `FoodLogFormScreen` (create mode): photo (pick / change before saving), the preview at 1:1, **Cuisine** (`CuisineField`, required), **Description** (multiline, optional, counter "n/280", hint "Don't add phone numbers, emails or addresses."), **Public** switch (on by default; value text "Anyone signed in can see this" / "Only you can see this"), **Save**. Save stays disabled with a reason until a photo and a cuisine are chosen. One save at a time (a second tap starts nothing).
- `app/food-log/[id]/index.tsx` (new) — thin, renders `FoodLogDetailScreen`: the full image (tap → `PhotoViewer`), the full description, the cuisine, the date, "Public" / "Private" as a word, **Edit** and **Delete** (confirm dialog: "Delete this photo? This can't be undone."). Unknown, deleted or someone else's private id: the not-found state "This photo isn't available." with Back (identical for each cause).
- `app/food-log/[id]/edit.tsx` (new) — thin, renders `FoodLogFormScreen` (edit mode): the photo shown but not changeable (Decision 8), cuisine, description, public switch, **Save**.

**4 states** on every new screen: loading (`Skeleton`), empty ("No food photos yet. Add your first one."), error (`ErrorState` with retry), success. The date shown is `local_date` formatted as a calendar date (never derived from `created_at` in the phone's zone).

## Database changes
One migration, `npx supabase migration new food_log_uploads`. SQL is ASCII-only; every non-ASCII character in a class is written as an escaped code point.

```sql
create table public.food_logs (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references public.profiles(id) on delete cascade,
  cuisine_code  text not null references public.cuisines(code) on update restrict on delete restrict,
  description   text,             -- null or 1..280 chars, trimmed; checks below
  is_public     boolean not null default true,
  local_date    date not null,    -- the author's local date at upload, set by the server (Decision 4)
  path          text not null unique,
  status        text not null default 'pending' check (status in ('pending', 'ready')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint food_logs_path_shape check (path = author_id::text || '/' || id::text || '.jpg'),
  constraint food_logs_description_len check (description is null or char_length(description) between 1 and 280),
  constraint food_logs_description_text check (description is null or description !~ '<c_hidden, Decision 2>'),
  constraint food_logs_local_date_near check (local_date between (created_at at time zone 'UTC')::date - 1
                                                         and (created_at at time zone 'UTC')::date + 1)
);
create trigger food_logs_set_updated_at before update on public.food_logs
  for each row execute function public.set_updated_at();
create index food_logs_author_list_idx on public.food_logs (author_id, created_at desc, id desc) where status = 'ready';
create index food_logs_author_date_idx on public.food_logs (author_id, local_date);   -- spec 14's grid
create index food_logs_author_pending_idx on public.food_logs (author_id, created_at) where status = 'pending';

-- Started uploads in a rolling 24 hours (Decision 9): deleting a log never gives one back.
create table public.food_log_upload_starts (
  author_id   uuid not null references public.profiles(id) on delete cascade,
  started_at  timestamptz not null default now()
);
create index food_log_upload_starts_idx on public.food_log_upload_starts (author_id, started_at);

-- Files whose row is gone (Decision 8; spec 06's queue needs a business_id, so it can't be reused).
create table public.food_log_cleanup_queue (
  path       text primary key,
  author_id  uuid not null,            -- no FK: rows must outlive a deleted account
  queued_at  timestamptz not null default now()
);
-- AFTER DELETE trigger on food_logs (also fires on the profiles cascade from account deletion):
-- insert old.path into the queue, on conflict do nothing.
```

The email and digit checks (Decision 11) live in the functions only, not as table checks, so an admin can still fix a row from the dashboard; the hidden-character, length and shape checks are both table checks and function checks.

### RLS and grants
All three tables: `enable row level security`, then `revoke all … from anon, authenticated`, in the same migration. **No grants and no policies** on any of them: every read and write goes through the functions below (Decision 10). The `00_rls_enabled` test covers them; `03-navigation-shell.test.sql` adds them to its ALLOWLIST (approved edit).

**Private helpers** (`private` schema, `security definer`, `stable`, `set search_path = ''`, execute revoked from `public` then granted to `authenticated` only):
- `private.food_log_upload_allowed(p_path text) returns boolean`: a `pending` row with this exact path, less than 1 hour old, whose `author_id = auth.uid()`.
- `private.food_log_is_readable(p_path text) returns boolean`: a `ready` row with this path that is either the caller's own or `is_public`.
- `private.food_log_is_live(p_path text) returns boolean`: any row with this path exists (stops deletes of live files).

The 05 test's exact list of `private` functions gains these three (approved edit).

### Field ownership

| Data | Owner can set | How |
|---|---|---|
| photo | once, at upload | `begin_food_log_upload` → upload → `finish_food_log_upload` |
| `cuisine_code`, `description`, `is_public` | at upload and any time after | `begin_food_log_upload`, `update_food_log` |
| `id`, `author_id`, `path`, `status`, `local_date`, `created_at`, `updated_at` | never | server |

### Functions
All `security definer`, `set search_path = ''`, each followed by `revoke execute … from public, anon, authenticated` then `grant execute … to authenticated`, and added to the 05 allowlist (approved edit). The author is always `auth.uid()`; no function takes a user id. An id that is missing, someone else's (for writes) or someone else's private one (for reads) raises `not_found`, with no difference between the causes. Validation runs before any row is read. Text checks use `is distinct from` / `is not distinct from` wherever a value can be null.

| Function | Behaviour |
|---|---|
| `begin_food_log_upload(p_cuisine_code text, p_description text, p_is_public boolean, p_time_zone text) returns jsonb` | 1. Validate: profile has a username, else `profile_incomplete`; `p_cuisine_code` exists in `cuisines`, else `invalid_input`; `p_is_public` not null, else `invalid_input`; `p_time_zone` is in `pg_timezone_names`, else `invalid_time_zone`; description trimmed with `c_edge`, blank → null, then hidden characters → `invalid_text`, over 280 → `invalid_input`, an email or a 10-digit run → `contact_info` (Decision 11). 2. Take `pg_advisory_xact_lock(hashtextextended('food_log:' || uid, 0))`. 3. **Expire:** delete the caller's `pending` rows older than 1 hour (the trigger queues their paths) and the caller's `food_log_upload_starts` rows older than 24 hours (Decision 9b). 4. `cleanup_required` if 20 or more of the caller's queued files still exist in `storage.objects`. 5. `too_many_pending` if 3 `pending` rows remain. 6. `daily_limit` if 20 starts in the last 24 hours. 7. `local_date := (now() at time zone p_time_zone)::date` (the table check bounds it to the UTC date ±1). 8. Insert the start and the `pending` row; return `{ id, path }`. |
| `finish_food_log_upload(p_id uuid) returns jsonb` | The caller's `pending` row less than 1 hour old, else `not_found`. The object must exist in `storage.objects` (bucket `food-logs`, `name = path`) with `metadata->>'mimetype' = 'image/jpeg'` and a size of 1 to 2 097 152 bytes, else `upload_missing`. Sets `ready`; returns the log object. |
| `update_food_log(p_id uuid, p_cuisine_code text, p_description text, p_is_public boolean) returns jsonb` | The caller's `ready` row, else `not_found`. Same validation as begin (no time zone). Returns the log object. |
| `delete_food_log(p_id uuid) returns void` | Deletes the caller's row, pending or ready, else `not_found`. The trigger queues the path. |
| `get_food_log(p_id uuid) returns jsonb` | A `ready` row that is the caller's own, or `is_public`; else `not_found`. |
| `list_my_food_logs(p_before text default null) returns jsonb` | The caller's `ready` rows, `(created_at desc, id desc)`, 50 a page, reading 51; `{ items, next_cursor }`. Cursor text `YYYY-MM-DD"T"HH24:MI:SS.US"Z"|<uuid>` exactly as `list_my_requests`, strict regex, anything else → `invalid_input`. |
| `claim_food_log_cleanup() returns setof text` | For the caller: drop queue rows older than 10 minutes whose object no longer exists; return the queued paths whose object still exists. The app removes them through Storage and calls it again. |

**Log object** (fixed key set, pinned by a pgTAP key-set test): `id, cuisine_code, description, is_public, local_date, created_at, path, is_mine`. It never holds `author_id`, `status`, `updated_at` or anything from `profiles`.

**Function allowlist (05 test, approved edit):** authenticated may additionally execute exactly the seven functions above. Anon executes no `public` function.

No request status transitions in this spec.

## Storage
**Bucket `food-logs`**, created in the migration (`insert into storage.buckets …`): `public = false`, `file_size_limit = 2097152`, `allowed_mime_types = {image/jpeg}` (Decisions 5, 10).

**Path:** `<author_id>/<log_id>.jpg`, made by `begin_food_log_upload`. Matches the CLAUDE.md rule `<auth.uid()>/…`.

**Policies on `storage.objects`** (each `bucket_id = 'food-logs'` first; no anon policy at all):
```sql
create policy food_logs_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'food-logs' and (select private.food_log_upload_allowed(name)));
create policy food_logs_select on storage.objects for select to authenticated
  using (bucket_id = 'food-logs' and (select private.food_log_is_readable(name)));
create policy food_logs_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'food-logs'
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and not (select private.food_log_is_live(name)));
-- No update policy: files are never overwritten (upsert false).
```
The folder comparison is text to text, so a malformed name never errors; it simply does not match (fails closed). A pgTAP test covers a non-UUID folder.

**Reading:** `signedUrls('food-logs', paths, 3600)` through the existing `useSignedUrls`; `PhotoTile` / `PhotoViewer` cache by path. A flip from public to private stops new URLs at once, but someone who already holds a signed URL can use it for up to 1 hour (Decision 10b; recorded in v1 §16 at gate C).

**Cleanup ("row first, file later"):** the same outbox as spec 06 with its own queue: the delete trigger queues the path; after a delete and when the list screen opens, the app calls `claim_food_log_cleanup()`, removes the returned paths, and claims again. `begin_food_log_upload` raises `cleanup_required` at 20 queued files still in storage; the app runs the cleanup and retries once. No server sweeper in v1 (§16, with account deletion).

**Image size and privacy (Decisions 5, 7):** reuse `prepareImage` unchanged: long edge ≤ 1600 px, JPEG 0.8 then 0.6, 2 MB, `stripJpegMetadata` then the strict `assertNoHiddenMetadata`; the upload sends only the stripped bytes. Same known limit as spec 06: Storage checks the declared type, not the bytes, and there is no server-side metadata check (§16).

## Edge Functions
None.

## Components & hooks
**`src/features/food-log/`** (new):
- `schema.ts`: `FoodLog` (the 8 keys, strict), `FoodLogPage` (`items`, `next_cursor`), the form schema (cuisine required; description trimmed, ≤ 280, hidden-character class and contact-info check mirroring the server, Decisions 2 and 11).
- `text.ts` (pure): `HIDDEN_FOOD_LOG` class, `hasContactInfo(text)` (email regex; strip spaces, `-`, `.`, `(`, `)`, `[`, `]`, then `[0-9]{10,}`), `trimDescription`. ASCII source with `\u` escapes only.
- `api.ts`: `beginFoodLogUpload`, `finishFoodLogUpload`, `updateFoodLog`, `deleteFoodLog`, `getFoodLog`, `listMyFoodLogs`, `claimFoodLogCleanup`; `FoodLogAppError` codes `'profile_incomplete' | 'invalid_input' | 'invalid_text' | 'contact_info' | 'invalid_time_zone' | 'too_many_pending' | 'daily_limit' | 'cleanup_required' | 'not_found' | 'upload_missing' | 'network' | 'unknown'` with `mapFoodLogError` and `messages.ts`. Storage calls stay in `media/api.ts`.
- `uploadFoodLog.ts`: `prepareImage` → `beginFoodLogUpload` (with the phone's zone from `expo-localization` `getCalendars()[0].timeZone`, falling back to `Intl` resolved options) → `uploadToBucket('food-logs', path, bytes)` → `finishFoodLogUpload`. On upload or finish failure: `deleteFoodLog(id)` then the cleanup. On `cleanup_required`: cleanup, retry begin once. Prepares the image **before** begin, so a bad photo uses no daily start.
- `hooks/`: `keys.ts` (`['food-log', 'mine']`, `['food-log', id]`), `useMyFoodLogs` (`useInfiniteQuery`, 50 a page, `next_cursor`), `useFoodLog(id)`, `useCreateFoodLog`, `useUpdateFoodLog`, `useDeleteFoodLog`, `useFoodLogCleanup`. Every create, update and delete invalidates the list and that log's detail.
- `components/`: `FoodLogListScreen`, `FoodLogRow`, `FoodLogFormScreen`, `FoodLogDetailScreen`.

**Profile (change):** `src/features/profile/components/FoodLogProfileRow.tsx` (a `NavRow` to `/food-log`), rendered by `ProfileScreen`.

**Accessible names:** row "Food photo, <cuisine name>, <date>. <description or 'No description'>. Private" (Private only when private), role button; thumbnail in the detail "Food photo, <cuisine name>, <date>. Opens full image."; Public switch "Public", state as words; Delete "Delete this photo", role button. Targets ≥ 44 pt.

## Files to create
- `supabase/migrations/<timestamp>_food_log_uploads.sql`
- `supabase/tests/13-food-log-uploads.test.sql`
- `src/features/food-log/` (`schema.ts`, `text.ts`, `api.ts`, `messages.ts`, `uploadFoodLog.ts`, `hooks/*`, `components/*`, `__tests__/*`)
- `src/features/profile/components/FoodLogProfileRow.tsx`
- `app/food-log/_layout.tsx` (titles "Food log", "Add photo", "Photo", "Edit photo"), `app/food-log/index.tsx`, `app/food-log/new.tsx`, `app/food-log/[id]/index.tsx`, `app/food-log/[id]/edit.tsx`

## Files to change
- `supabase/tests/05-seller-onboarding.test.sql` (approved): function allowlist + the exact `private` function list.
- `supabase/tests/03-navigation-shell.test.sql` (approved): table ALLOWLIST gains `food_logs`, `food_log_upload_starts`, `food_log_cleanup_queue`.
- `src/features/profile/components/ProfileScreen.tsx` and `src/features/profile/__tests__/ProfileScreen.test.tsx` (approved): the Food log row.
- `src/features/media/__tests__/mediaIsolation.test.ts`: only if forced (it bans media importing `sellers/` or `menu/`; food-log importing media should not touch it).
- `src/types/database.ts`: regenerate with `npm run db:types`.
- `app.config.ts`: `photosPermission` → "LikeToOrder uses your photos to add pictures to your food log, menu and listing." (Decision 18; native rebuild by Archan).
- `.claude/skills/supabase-patterns/SKILL.md` (gate C, Decision 19): the `food_logs` logical model uses `path` (not `photo_path`); drop the `avatars` bucket row and `avatar_path` / `is_admin` from `profiles`; replace the `food_logs` direct-policy template with the functions-only rule and the `food-logs` bucket as built (1 h signed URLs, no "longer-lived" note).
- `docs/product/v1.md` (gate C): §16 gains the public-to-private signed-URL hour (Decision 10b), the food-logs bucket in the storage-use item, and "report an upload" for the spec that first shows uploads to others (Decision 12); a changelog line at ship.
- `CLAUDE.md`: add `food-log` to the feature-folder list at ship.

## New dependencies
No new dependencies. `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, `expo-image` and `expo-localization` are installed (spec 06). The `photosPermission` text change needs one native rebuild (`npx expo run:ios`, run by Archan after gate D).

## Rules for implementation
Always include:
- RLS on every new table + pgTAP test
- Supabase calls only in `src/features/<x>/api.ts` (Storage calls only in `src/features/media/api.ts`)
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility labels on every touchable

Feature-specific rules:
- **No client grants** on the three tables; every read and write through the functions; revoke-then-grant on every function; helpers in `private` only.
- **Author from `auth.uid()`**; paths made by the server; no client time or date ever sent (only the zone name).
- **Every photo goes through `prepareImage`**, and only its stripped bytes are uploaded. Never the picker's file or the encoder's file. Never loosen `assertNoHiddenMetadata`.
- **Do not log** photo bytes, URIs, paths, signed URLs or descriptions.
- **Row first, file later.** Never remove a file whose row exists; `finish_food_log_upload` checks the object.
- **SQL hygiene (lessons of 09 to 12):** `is distinct from` / `is not distinct from` in every null-sensitive check; ASCII-only SQL; every non-ASCII character in a class or a test literal written as an escaped code point (`U&'\200D'`, `E'\u200D'`, `E'\U0001F468'`).
- **Byte and invisible-character checks:** SQL and TS added for this spec hold no non-ASCII byte (`perl -ne 'print "$ARGV:$.: $_" if /[^\x00-\x7F]/'`); markdown changed by this spec passes the spec 11 invisible-character class (`perl -CSD`). Each command is first proved on a scratch file holding one such character.
- **Deliberate-break proofs** (Test plan): each break turns a named test red, then is reverted. SQL breaks run inside the test transaction (`create or replace` in `lives_ok`, rolled back), never committed.
- **Tests:** own `QueryClient` per test (`retry: false`, `gcTime: 0` for queries **and** mutations), `cleanup()` and `client.clear()` in `afterEach`; faithful fakes (the `jest.setup.ts` picker, manipulator, file-system and localization fakes as they are; a Storage fake shaped like `media/__tests__/api.test.ts` that records the bytes it got and refuses `upsert: true`); every RNTL v14 call awaited; `waitFor`, never fixed timers.
- **Stale lists:** create, update and delete invalidate the list and the detail; a not-found detail after delete never flashes (close on success, as spec 06 Decision 31).
- **Older tests:** only `05-seller-onboarding.test.sql`, `03-navigation-shell.test.sql`, `ProfileScreen.test.tsx`, and `mediaIsolation.test.ts` only if forced. Any other older test that needs a change: stop and ask.
- **Spec 04 display rule** wherever a cuisine appears (`CuisineLabel`).
- Stage gates, stop and commit after each (no edits before "approved"):
  - PR 1: **A** migration + types → **B** pgTAP + approved pgTAP edits + SQL breaks → **C** skill and v1 §16 docs → review, CI, merge.
  - PR 2: **D** feature code, routes, Profile row, `app.config.ts` text → *Archan rebuilds* → **E** jest tests + approved jest edit + app breaks → **F** Simulator run (Archan), review, ship.

## Known pitfalls (checklist)
- [ ] A stale pending row (over 1 hour) must stop counting and be queued, not block the person (pgTAP, 59 vs 61 minutes).
- [ ] Deleting a log must not give back a daily start (pgTAP: 20 starts, delete one, the 21st is still `daily_limit`).
- [ ] A bad photo (too large, not an image, metadata) must fail before `begin`, using no daily start (jest).
- [ ] The date shown must come from `local_date`, never `created_at` in the phone's zone (jest with a zone far from UTC).
- [ ] Emoji with U+200D / U+FE0F accepted; the England, Scotland and Wales flags use tag characters (U+E0020 to U+E007F) and are refused with the rest of the hidden set (known and accepted, Decision 2).
- [ ] Two dates written next to each other (for example "2026-11-14 2026-11-15") join into 16 digits once spaces and dashes are ignored and are refused as `contact_info` (known edge of Decision 11). Digits in other scripts are not counted (known limit).
- [ ] Leftover seed data must not change pgTAP counts: own fixtures, counts of own rows only, rolled back.
- [ ] Test clients set `gcTime: 0` for mutations too.

## Out of scope
- Community feed, comments, likes, saves, follows, tagging restaurants or places in posts, dish-name fields (v1 §3; Decision 1).
- More than one photo per upload; camera capture (Decision 6).
- The activity grid, day panel and stats (spec 14); the cuisine view (spec 15).
- Viewing another person's profile or uploads in the app; reporting an upload (Decision 12); reports are spec 17 (sellers only).
- Profile photos / avatars (§15 Q4).
- Notifications of any kind (Decision 13).
- Changing an upload's photo, date or time (Decision 8).
- A server-side metadata check, an abandoned-files sweeper, account deletion (§16).
- A lifetime storage cap per person (Decision 17).
- Everything in v1 §3.

## Definition of done
**PR 1 (pgTAP unless noted):**
- [ ] RLS on for the three tables; exact `table_privs_are` (no privileges for anon or authenticated); the bucket row is private, 2 097 152 bytes, `{image/jpeg}`; exactly 3 `food-logs` policies and no update or ALL policy.
- [ ] begin → upload → finish works for a profile-complete user; `local_date` follows the zone (`Pacific/Kiritimati` and `Pacific/Pago_Pago` around a UTC midnight give different dates); an unknown zone → `invalid_time_zone`; no username → `profile_incomplete`; unknown cuisine → `invalid_input`.
- [ ] `created_at` is the server's `now()`; no function accepts a time or a date.
- [ ] Description: trimmed; blank → null; 281 characters → `invalid_input`; "Ate on 2026-11-14" accepted; a 9-digit run accepted; "123-456-7890" (10 digits) → `contact_info`; "a@b.co" → `contact_info`; an emoji ZWJ sequence with U+FE0F (`E'\U0001F468\u200D\U0001F373 \u2764\uFE0F'`) accepted; U+202E (bidi override) → `invalid_text`; also U+200B, U+2066 and U+00AD → `invalid_text`; the table check refuses the same hidden characters on a direct superuser insert (23514).
- [ ] Limits: 3 pending → the 4th `too_many_pending`; a pending row backdated to 61 minutes is deleted by the next begin, its path is queued, and it no longer counts; at 59 minutes it still counts and can still be uploaded to and finished; 20 starts in 24 hours → the 21st `daily_limit`, also after deleting one; a start backdated past 24 hours stops counting; 20 queued files still in storage → `cleanup_required`, 19 → allowed.
- [ ] `finish_food_log_upload`: no object, wrong bucket, `image/png`, size 0, missing, `'abc'` or 2 097 153 → `upload_missing`.
- [ ] Update changes only cuisine, description and visibility; delete queues the path; deleting the author's `auth.users` row queues every path (pending and ready).
- [ ] Reads: the owner gets own private and public logs; another signed-in user gets a public ready log and `not_found` for a private or pending one; list returns only the caller's ready rows, 50 a page, no skip, repeat or empty last page across 123 rows (120 sharing one timestamp); a bad cursor → `invalid_input`; the log object has exactly the 8 keys.
- [ ] **An outsider cannot:** read another person's private log (function or storage select); list another person's logs; update or delete another person's log (`not_found`, row unchanged); insert an object into another person's folder, an unreserved path, an expired (61 minutes) reservation or a malformed (non-UUID) folder; delete another person's file or any live file (0 rows); update any object (0 rows); read or write the three tables directly (42501); execute any spec 13 function or `private` helper as `anon`. `anon` reads no `food-logs` object.
- [ ] The 05 allowlist and private list and the 03 ALLOWLIST include the new names (approved edits); every other older pgTAP file passes unedited.
- [ ] `npx supabase db reset`, `npx supabase test db`, `npm run typecheck` pass; `src/types/database.ts` regenerated, not hand-edited.

**PR 2 (jest unless noted):**
- [ ] Upload order prepare → begin → upload → finish; only `prepareImage`'s bytes reach Storage (never the picked URI); upload or finish failure deletes the pending log and runs the cleanup; `cleanup_required` → cleanup and one retry; a `too_large` photo never calls begin.
- [ ] The zone sent is the phone's (`getCalendars` fake), and no date or time is sent.
- [ ] Form: Save disabled with a reason until photo and cuisine; one save at a time; the counter; the hint; client-side `contact_info` and hidden-character messages for the same cases as pgTAP (date, 9 digits, 10 digits, email, emoji, bidi); every `FoodLogAppError` code has a message.
- [ ] List: 4 states, paging on `next_cursor`, "Private" as a word, row labels; detail: 4 states, not-found identical for each cause, delete confirm, close on success with no not-found flash; edit keeps the photo.
- [ ] Every create, update and delete invalidates the list and the detail.
- [ ] Profile shows the Food log row and opens `/food-log` (approved `ProfileScreen.test.tsx` edit).
- [ ] The date shown is `local_date` (checked with a fake zone far from UTC).
- [ ] Every touchable has a label and role; targets ≥ 44 pt; switch state as words.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` pass; spec 02 to 12 tests pass unedited except the approved list.
- [ ] Byte and invisible-character checks pass, each proved on a scratch file first.
- [ ] Simulator run passed (Archan, Decision 15).

## Test plan
- **Database tests (pgTAP)** in `supabase/tests/13-food-log-uploads.test.sql`: everything under PR 1 above; own fixtures with fixed ids (`...1301` to `...13xx`: owner, second user, outsider, user without a username, anon); `begin; ... rollback;`; `pg_temp.as_user` impersonation as in spec 11; storage fixtures and `pg_temp.put` as in spec 06; `set local storage.allow_delete_query = 'true'`; time moved by backdating fixture timestamps as the superuser (no sleeps); every non-ASCII test literal written as an escaped code point.
- **Unit/component tests (jest)** in `src/features/food-log/__tests__/`: `text.test.ts`, `schema.test.ts`, `api.test.ts` (RPC names, args, every error code), `uploadFoodLog.test.ts`, the hooks (paging, invalidation), `FoodLogListScreen`, `FoodLogFormScreen` (create and edit), `FoodLogDetailScreen`, `FoodLogProfileRow`; plus the approved `ProfileScreen.test.tsx` edit.
- **Deliberate breaks** (each turns a named test red, then is reverted):
  1. SQL: drop the author filter in `delete_food_log` — the outsider-delete test fails.
  2. SQL: let `food_log_is_readable` ignore `is_public` — the outsider storage-select test fails.
  3. SQL: skip the daily cap — the 21st-start test fails.
  4. SQL: skip the 1-hour expiry in begin — the 61-minute pending test fails.
  5. SQL: change the digit run to 7 — the 9-digit test fails.
  6. SQL: drop U+202E from the hidden class — the bidi test fails.
  7. SQL: drop the zone check — the unknown-zone test fails.
  8. App: upload the picked URI's bytes instead of `prepareImage`'s — the stripped-bytes test fails.
  9. App: skip list invalidation after delete — the stale-list test fails.
  10. App: format the date from `created_at` — the far-zone date test fails.
- **Manual check, iOS Simulator (Archan, after the rebuild), Decision 15:** the new permission text; add a photo from the Simulator's Photos (its sample photos carry GPS); the stored file has no metadata (`exiftool` on the object downloaded from local Studio); the form, the 4 states, paging (seeded), edit, delete, private and public; the 10-digit and email messages; the largest text size; VoiceOver in the Simulator where possible.
- **Real device, before launch (§16):** HEIC from a real iPhone camera, "Most Compatible", Android makes; VoiceOver and TalkBack; real-phone upload over a slow network.

## Decisions
Approved by Archan on 2026-11-14: all 18 recommended defaults as written, with changes to 2, 9, 10 and 11, plus Decisions 19 and 20.

1. **Who uploads; what a post is:** any signed-in user with a finished profile, customers and sellers alike, personal (not a business). A post is one photo, an optional description, a required cuisine and public/private. No place link and no dish-name field (§3).
2. **Description:** optional, trimmed, 1 to 280 characters, newlines allowed. **Allowed:** U+200D and U+FE0F (emoji). **Refused** (`invalid_text`), written as escaped code points: ASCII controls except newline (`\x00-\x09\x0B-\x1F`), DEL and C1 (`\u007F-\u009F`), U+00AD, U+061C, U+180E, U+200B, U+200C, U+200E, U+200F, U+2028, U+2029, bidi overrides and embeddings U+202A to U+202E, U+2060 to U+2064, bidi isolates U+2066 to U+2069, U+FEFF, U+FFF9 to U+FFFB, and tags U+E0000 to U+E007F. Tests for an emoji sequence (accepted) and a bidi override (refused). Note: refusing U+200C (zero-width non-joiner) can affect some Persian and Indic spellings, and refusing tags removes the England, Scotland and Wales flag emoji; both follow the "other invisible formatting" rule and are listed in Known pitfalls.
3. **Visibility:** public = readable by any signed-in user, never guests; private = owner only. In this spec the only UI is the owner's own list and detail; the server rules for others are built and tested now.
4. **Local date:** the app sends its IANA zone name; the server checks it against `pg_timezone_names` and computes `(now() at time zone tz)::date`; a table check keeps it within the UTC date ±1. The client never sends a date or a time.
5. **Photo:** one per upload; JPEG only in the bucket; `prepareImage` unchanged (1600 px, 0.8 then 0.6, 2 MB); HEIC, PNG and WebP sources are converted on the phone.
6. **Camera:** library only in v1; no camera permission.
7. **EXIF and GPS:** always stripped (`stripJpegMetadata` + the strict check); no option to keep; no server-side check (§16).
8. **Edit and delete:** owner only; description, cuisine and visibility can change; the photo, date and time never do (replace = delete and add again). Delete has a confirm step; row first, file later through `food_log_cleanup_queue`.
9. **Rate limits:** (a) 20 started uploads per person per rolling 24 hours, kept in `food_log_upload_starts` so deleting never gives one back; at most 3 unfinished uploads; the `cleanup_required` cap at 20 queued files; message "You've added a lot of photos today. Try again tomorrow." (b) **Changed:** an unfinished (`pending`) upload older than 1 hour stops counting toward the 3 and is deleted, with its path queued for cleanup, **on the caller's next `begin_food_log_upload`** (the spec 06 pattern; the insert policy and `finish` already refuse a reservation over 1 hour old, so a stale row is harmless until then). pgTAP covers 59 and 61 minutes.
10. **Bucket and access:** private bucket `food-logs`, path `<uid>/<log_id>.jpg`, signed URLs for 1 hour, no client table grants, everything through security-definer functions and `private` helpers. (b) **Added:** v1 §16 records (at gate C) that a public-to-private flip can take up to 1 hour to take effect for someone who already holds a signed URL; this matters only once other people can view uploads.
11. **Text rules (changed):** the server refuses an email address and a run of **10 or more** digits (ignoring spaces, dashes, dots and brackets) with `contact_info`, so a date like 2026-11-14 is accepted; the app mirrors it. Tests: a date (accepted), a 9-digit run (accepted), a 10-digit run (refused). Addresses: hint only ("Don't add phone numbers, emails or addresses.").
12. **Reporting and moderation:** no report button in this spec; an admin removes content from the Supabase dashboard (§15 Q3); "report an upload" goes to the spec that first shows uploads to other people, recorded in v1 §16 at gate C.
13. **Notifications:** none.
14. **Two PRs:** backend (gates A to C, review, CI, merge) and app (gates D to F, review, ship). No new dependency.
15. **Simulator vs device:** the Simulator covers picking from Photos, the exiftool proof, all screens and states, edit, delete and the largest text size; a real camera's HEIC, Android, VoiceOver and TalkBack are before-launch items in §16.
16. **Entry point:** a Food log row on Profile; Add photo on the Food log screen.
17. **No lifetime storage cap** in v1; the food-logs bucket joins the §16 storage-use item.
18. **Permission text:** "LikeToOrder uses your photos to add pictures to your food log, menu and listing." in PR 2; Archan rebuilds once.
19. **Skill correction (mismatches 1 and 12):** at gate C, `supabase-patterns` gets the column name `path`, loses the `avatars` bucket and the `avatar_path` / `is_admin` columns, and its `food_logs` template becomes the functions-only storage rule as built.
20. **Older tests allowed to change:** `05-seller-onboarding.test.sql`, `03-navigation-shell.test.sql`, `ProfileScreen.test.tsx`, and `mediaIsolation.test.ts` only if forced. Anything else: stop and ask.

### Mismatches between the product spec and the code (found while writing this spec)
1. `supabase-patterns` "Core tables" lists `profiles.avatar_path` and `is_admin`, and its Storage table lists an `avatars` bucket; none exist, and §15 Q4 puts avatar upload out of scope. Fixed at gate C (Decision 19).
2. Spec 06's overview says spec 13 covers "food log and profile photo"; profile photos are out of scope (§15 Q4).
3. §11 says "visitors don't see" private uploads, which assumes visitors can open another profile; there is no such route, and `profiles` is readable by signed-in users only, so "public" means other signed-in users (Decision 3).
4. The skill's storage note says "public uploads can use longer-lived signed URLs"; nothing does that (1 hour everywhere). Removed at gate C.
5. Spec 06's `storage_cleanup_queue.business_id` is `not null`, so personal uploads get their own queue.
6. The brief asked about a place link and followers; v1 §3 rules out tagging restaurants in posts and follows.
7. Spec 17 is "report a seller" only; nothing in v1 reports an upload (Decision 12).
8. The brief mentioned profile images in storage; only `business-media` exists.
9. Free-text checks in SQL block hidden characters only; no email or phone detection existed, so Decision 11's check is new.
10. `app.config.ts`'s photo-library text spoke only of "menu and listing" (Decision 18; native rebuild).
11. The 05 pgTAP test pins the exact `private` function list, so the three helpers need the approved edit.
12. `supabase-patterns` gives a `food_logs` template with direct table policies and the column name `photo_path`, which conflicts with the functions-only practice since spec 06; its local-date note (IANA zone checked against `pg_timezone_names`) matches Decision 4 but nothing built it yet. Fixed at gate C (Decision 19).
13. There is no shared Supabase fake or shared test `QueryClient`; some older tests set `gcTime: 0` for queries only. Spec 13's tests build their own as in the Rules.

## Open questions
None. All 18 resolved on 2026-11-14; see Decisions.
