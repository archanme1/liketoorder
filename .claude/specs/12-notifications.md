# Spec 12: Notifications

**Branch:** `feature/notifications` (renamed to `feature/notifications-backend` before PR 1's first push) and `feature/notifications-app` (PR 2) (two PRs from this one spec, same pattern as specs 09 to 11)
- PR 1 (backend: migration, triggers, outbox, functions, daily cap, server seen flag, `push-sender` Edge Function, pgTAP, Deno tests, types): `feature/notifications-backend`
- PR 2 (the app: `expo-notifications`, token registration, permission primer, Profile settings, tap routing, foreground refresh, server badge, jest tests): `feature/notifications-app`, created from `main` after PR 1 is merged.
**Product spec:** `docs/product/v1.md` §2 (push notifications in v1), §3 (out of scope), §4 (Navigation, the Requests tab number), §8 (Pickup requests), §9 (Table requests, I've arrived), §12 (Notifications), §14 row 12, §16 (cancel after accept needs a seller notification; overall daily cap and notification throttling; customer badge is per phone; polling under stacked screens; the seller's words are not put into notification text; cross-feature imports; hosted extensions; function privileges)
**Plan mode:** required — new tables with RLS, triggers on both request tables, new and changed Postgres functions, a new Edge Function, a new native dependency (`expo-notifications`, needs a rebuild), new routes, and a change to sign-out (auth); far more than ~5 files.
**Status:** 🚧 In progress (PR 1 backend in review; PR 2 app not started)

## Overview
After this ships, a business owner's phone gets a push notification when a pickup or table request arrives, when a customer cancels a pending request, and when a customer taps **I've arrived**. A customer's phone gets one when their request is accepted, declined or expires. Every text is a short fixed sentence; customer pushes may name the place, seller pushes name nobody. A notification never contains a request note, a response note, order text, an address, an email or a phone number; the details open inside the app after sign-in. Tapping a notification opens the right request (with its kind) after sign-in; a signed-out phone or a different account sees nothing it should not. Each kind of notification can be switched off in Profile, and the permission prompt is shown after a plain explanation at a sensible moment, never at launch.

Delivery is reliable and safe: the database writes an **outbox** row in the same transaction as the event (no lost events, nothing sent for a rolled-back change), and an Edge Function (`push-sender`) sends through Expo's push service, reads receipts, removes dead tokens, retries with a limit, and never blocks the user's action. The customer's "changed" badge moves from the phone (10b's `statusMemory`) to a server-side seen flag. The 11b carry-forward is closed: an overall daily request cap across places, and notification throttling and collapsing so a script cannot buzz a seller's phone over and over.

**Why now:** both request kinds (09, 11), the Requests tab (10b), limits (11b) and filters (11c) exist, so every event the notifications describe is final. v1 §2 lists push notifications for request status as in scope.

## Depends on
- 02 auth-and-profiles ✅
- 03 navigation-shell ✅
- 05 seller-onboarding ✅ (`businesses.owner_id`, `profiles.is_seller`)
- 09 pickup-requests ✅
- 10 seller-request-inbox ✅
- 10b requests-tab-and-answers ✅ (Requests tab, badges, `statusMemory`)
- 11 table-requests ✅ (`table_requests`, `mark_arrived`)
- 11b request-limits ✅ (submit limits the daily cap is added to)
- 11c requests-filters ✅

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §2, §3, §4, §8, §9, §12, §16
- This spec, and `.claude/specs/10b-requests-tab-and-answers.md` (Decisions 7, 8, 16 to 18), `.claude/specs/11-table-requests.md` ("Functions", "Function privileges", "Known pitfalls"), `.claude/specs/11b-request-limits.md`
- `.claude/skills/supabase-patterns/SKILL.md`, `.claude/skills/liketoorder-ui/SKILL.md`
- **PR 1:** `supabase/migrations/20261105040319_restaurant_map.sql` (`invoke_places_refresh`, vault, `cron.schedule`, lines ~440 to 465 only), `20261110012046_table_requests.sql` (`expire_pickup_requests`, the JSON builders), `20261111025456_request_limits.sql` (both submit functions); `supabase/tests/05-seller-onboarding.test.sql` (allowlist), `supabase/tests/11-table-requests.test.sql` (helpers and style); `supabase/functions/places-refresh/{index,handler}.ts`, `supabase/functions/_shared/http.ts`, `supabase/functions/tests/{helpers,places-refresh}.test.ts`, `supabase/functions/deno.json`, `supabase/config.toml` (`[functions.*]`)
- **PR 2:** `app.config.ts`, `jest.setup.ts`, `app/_layout.tsx`, `src/features/auth/{api.ts,routeAccess.ts,returnTo.ts}`, `src/features/auth/components/AuthProvider.tsx`, `src/features/auth/hooks/useSignOut.ts`, `src/features/profile/components/ProfileScreen.tsx`, `src/components/ui/NavRow.tsx`, `src/features/sellers/components/{SellerScreenGate,LabelledSwitch}.tsx`, `src/features/requests/{api,statusMemory}.ts`, `src/features/requests/hooks/{keys,useCustomerUpdates,useRequestsBadge,useWaitingCount,useCancelPickupRequest,useCancelTableRequest,useSubmitPickupRequest,useSubmitTableRequest}.ts`, `src/features/requests/components/RequestsTabScreen.tsx`, `app/(tabs)/{_layout,requests}.tsx`, `app/requests/[id].tsx`, `app/seller/requests/[id].tsx`, and the tests listed under "Files to change"

## User stories
- As a business owner (seller mode on or off), I get a notification when a pickup or table request arrives, so that I can answer it before it expires.
- As a business owner, I get a notification when a customer cancels a pending request or taps I've arrived.
- As a customer, I get a notification when my request is accepted, declined or expires, naming the place but nothing else.
- As anyone, tapping a notification opens that request after I sign in; if the phone is signed out or signed in as someone else, I see nothing private.
- As anyone, I see a plain explanation before the system asks for permission, at a moment when it makes sense, and I can say Not now.
- As anyone, I can switch each kind of notification off in Profile, and see how to turn notifications back on in the phone's Settings if I denied them.
- As a seller, a customer (or a script) sending and cancelling many requests cannot make my phone buzz without limit.
- As a customer, the number on the Requests tab is the same on every phone I use.
- As an outsider, I cannot read, register over or remove another person's device token, read or change their settings, or read the outbox.
- As a screen-reader or large-text user, the primer, the settings switches and the Profile row have labels, roles and state as words.

## Screens & routes
- `app/profile/notifications.tsx` (new) — thin screen rendering `NotificationSettingsScreen`: the switches (Decision 4) with the permission state on top: not asked → "Turn on notifications" (opens the primer); denied → "Notifications are off in your phone's Settings" with **Open Settings**; granted → switches only. Signed-in.
- `app/notifications/allow.tsx` (new, modal) — thin screen rendering `NotificationsPrimer`: a plain explanation ("We'll let you know when a place answers your request" / for owners "…when a new request arrives"), **Turn on** (then the system prompt) and **Not now**. Signed-in.
- `app/notifications/open.tsx` (new) — the tap resolver (no visible UI beyond a loading state and the neutral line below). Validates the payload, waits for the session, then routes (see "Tap routing"). Reachable signed out (it sends the person to sign-in with `returnTo`).
- `ProfileScreen` (change) — a **Notifications** row (`NavRow`) between the seller-mode row and Sign out, value "On" / "Off" / "Off in Settings".
- `app/requests/[id].tsx`, `app/seller/requests/[id].tsx` (no change) — the resolver's targets.
- States on every new screen: loading, empty (not applicable to settings; the primer has none), error with retry (settings load and save), success. A pending request is never described as confirmed in any notification text, screen or spoken label.

### Tap routing (decided)
- Payload `data` is `{ v: 1, kind: 'pickup' | 'table', id: <uuid>, side: 'sent' | 'received' }`. Anything else (wrong version, bad uuid, unknown kind or side, extra keys) → the Requests tab, nothing else.
- **Signed out:** the resolver stores the target with spec 09's `returnTo` and opens sign-in; after sign-in the resolver runs again.
- **`side: 'sent'`:** `/requests/[id]?kind=<kind>`. A different account gets the detail's existing not-found state, which is identical for "unknown" and "someone else's" (server rule since spec 09).
- **`side: 'received'`:** the resolver first loads `useMyBusiness`; with a business → `/seller/requests/[id]` (whose server read is owner-scoped); with no business (a wrong account) → the Requests tab with the neutral line "This notification was for another account." It never routes to `/seller/onboarding` (`SellerScreenGate` would redirect there).
- Cold start uses `useLastNotificationResponse`; warm taps use the response listener. One tap routes once.

## Database changes
One migration in PR 1, `npx supabase migration new notifications`. Never edit an existing migration. Sketch only; the plan checks names against the current migrations. **ASCII-only SQL, escaped code points for any character class, `is distinct from` / `is not distinct from` in every comparison where either side can be NULL.**

```sql
create table public.push_tokens (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  token              text not null unique
    check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$'),
  platform           text not null check (platform in ('ios','android')),
  created_at         timestamptz not null default now(),
  last_registered_at timestamptz not null default now()
);
create table public.notification_settings (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  answers     boolean not null default true,   -- customer: accepted, declined, expired
  new_requests boolean not null default true,  -- owner
  cancellations boolean not null default true, -- owner
  arrivals    boolean not null default true,   -- owner
  updated_at  timestamptz not null default now()
);  -- a missing row means every switch on

create table private.notification_outbox (
  id              bigint generated always as identity primary key,
  recipient_id    uuid not null references public.profiles (id) on delete cascade,
  event           text not null check (event in
                    ('new_request','cancelled','arrived','accepted','declined','expired')),
  request_kind    text not null check (request_kind in ('pickup','table')),
  request_id      uuid not null,
  business_id     uuid not null references public.businesses (id) on delete cascade,
  status          text not null default 'queued'
                    check (status in ('queued','sending','sent','skipped','failed')),
  skip_reason     text check (skip_reason is null or skip_reason in
                    ('setting_off','no_token','stale','collapsed','throttled','cancelled_before_send')),
  group_count     smallint not null default 1, -- events one push stands for (> 1 only on a collapsed lead row)
  attempts        smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);  -- holds NO text: texts are built at send time from fixed templates
create table private.push_tickets (
  ticket_id  text primary key,
  outbox_id  bigint not null references private.notification_outbox (id) on delete cascade,
  token_id   uuid references public.push_tokens (id) on delete set null,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);

alter table public.pickup_requests add column customer_unseen boolean not null default false;
alter table public.table_requests  add column customer_unseen boolean not null default false;
-- indexes: outbox (status, next_attempt_at) where status in ('queued','sending');
--   outbox (recipient_id, event, sent_at); tokens (user_id);
--   partial (customer_id) where customer_unseen on both request tables.
```

**Existing rows (Decision 17):** the new `customer_unseen` column defaults to false, so every request that exists at release starts as seen: no badge flood when this ships. The old per-phone memory is not migrated.

### RLS and grants
- `push_tokens`, `notification_settings`: **RLS on, no policies, no client grants** (same as the request tables). pgTAP asserts no privilege for `anon` / `authenticated` on the tables or any column.
- `private.notification_outbox`, `private.push_tickets`: in the `private` schema (not exposed by the API), **RLS on, no policies, no grants** to `anon`, `authenticated` or `public`.
- The user is always `auth.uid()`; no client function takes a user id.

### Event triggers (decided)
`private.enqueue_request_event()`, an `after insert or update of status, arrived_at` row trigger on `pickup_requests` and `table_requests`. It only inserts outbox rows and sets the seen flag; it never raises for delivery reasons, so it cannot block or fail the user's action.

| Change | Event | Recipient | Setting |
|---|---|---|---|
| insert (status `pending`) | `new_request` | business owner | `new_requests` |
| `pending` → `cancelled` | `cancelled` | business owner | `cancellations` |
| `arrived_at` null → set | `arrived` | business owner | `arrivals` |
| `pending` → `accepted` | `accepted` | customer | `answers` |
| `pending` → `declined` | `declined` | customer | `answers` |
| `pending` → `expired` | `expired` | customer | `answers` |

- `accepted` → `completed` / `no_show` writes no outbox row (Decision 1) but **does** set `customer_unseen = true`.
- **Seen flag:** every status change not made by the customer (accepted, declined, expired, completed, no_show) sets `customer_unseen = true` in the same trigger (a `before update` part of the trigger, or the trigger function on the row; the plan picks one). A customer's own cancel does not (10b Decision 18). Old-to-new comparisons use `is distinct from`.
- The owner is read from `businesses.owner_id` at event time. A customer cannot request their own business (spec 09), so no event targets its own author.
- Rows written in a transaction that rolls back disappear with it.

### Kick and schedules (decided)
- `private.invoke_push_sender()`: copies `private.invoke_places_refresh()` exactly: reads vault secrets `push_sender_url` and `push_sender_secret`; **if either is missing, or `pg_net` is not installed, returns quietly** (Decision 21); otherwise `net.http_post` with the `x-cron-secret` header and an empty body. `pg_net` queues the call in the current transaction, so a rolled-back change sends no kick.
- The event trigger calls it after inserting an outbox row (at most once per transaction, via a transaction-local flag such as `set_config('liketoorder.push_kick', '1', true)`).
- `cron.schedule('push-sender', '* * * * *', 'select private.invoke_push_sender()')`: sweeper for retries, held (throttled) rows and receipts.
- `cron.schedule('push-outbox-cleanup', '15 4 * * *', 'select private.cleanup_push_outbox()')`: deletes outbox rows that are `sent`, `skipped` or `failed` and older than 7 days, tickets older than 7 days, and tokens whose `last_registered_at` is over 60 days old.

### Throttling and collapsing (decided, Decision 6)
Applied inside `claim_push_batch` when a row is due:
- **New requests, per recipient and business:** the first is sent at once. If a `new_request` push was sent to that owner less than **5 minutes** ago, the row is held until 5 minutes after that push. When the window ends, every held `new_request` row for the owner is sent as **one** collapsed push ("You have {n} new requests waiting."); the others become `skipped / collapsed`. The collapsed push carries the **newest** request's kind and id, so a tap opens it.
- **Cancellations:** the same 5-minute rule and the same collapsing, in their own bucket (newest request's kind and id; "{n} requests were cancelled." when the count is over 1). If a cancelled request's `new_request` row is still unsent (queued or held), **both** rows become `skipped / cancelled_before_send`.
- **Stale:** a `new_request` whose request is no longer `pending` (or is past `expires_at`) when due is `skipped / stale`.
- **Hard cap:** at most **20 pushes per recipient per rolling hour**; beyond that rows are `skipped / throttled`. `arrived` is exempt.
- **Settings:** a switch that is off at send time → `skipped / setting_off`. No token → `skipped / no_token`.
- No quiet hours (Decision 5).

### Daily request cap across places (decided, Decision 6)
`submit_pickup_request` and `submit_table_request` are replaced (`create or replace`, bodies copied from `20261111025456_request_limits.sql`, behaviour otherwise unchanged) with one new check after the 11b checks: if the caller already has **30** requests of both kinds together, to all places, created in the rolling 24 hours, refuse with `daily_limit` (every status counts). The idempotent replay still returns the original request before any limit is checked.

### Retries and receipts (decided)
- Up to **5** attempts: after the 1st to 4th failure the row waits 1, 2, 4 and 8 minutes; the 5th failure makes it `failed`.
- Retry on network errors, Expo 5xx and `MessageRateExceeded`. `DeviceNotRegistered` (ticket or receipt) deletes that token. `MessageTooBig` and `InvalidCredentials` fail with no retry.
- Receipts are fetched for tickets at least 15 minutes old and not yet checked; tickets older than 24 hours with no receipt are dropped by the cleanup.
- A row is claimed with `for update skip locked`; a `sending` row whose `claimed_at` is over 5 minutes old is claimable again (crashed sender).

### Functions
All `security definer`, `set search_path = ''`, revoked from `public, anon, authenticated` (and `service_role` for private ones), granted as listed.

| Function | Grant | What it does |
|---|---|---|
| `register_push_token(p_token text, p_platform text)` | authenticated | Validates the format; upserts by token; a token held by another user **moves** to the caller; refreshes `last_registered_at`; keeps at most 10 per user (the oldest by `last_registered_at` is deleted). Codes: `not_signed_in`, `invalid_input`. |
| `unregister_push_token(p_token text)` | authenticated | Deletes the row only if it is the caller's. Unknown or someone else's token: the same success answer, nothing changed. |
| `get_notification_settings()` | authenticated | The caller's four switches (defaults when no row). |
| `set_notification_settings(p_answers, p_new_requests, p_cancellations, p_arrivals)` | authenticated | Upserts the caller's row; nulls rejected (`invalid_input`). |
| `count_my_request_updates()` | authenticated | Count of the caller's requests (both kinds) with `customer_unseen`. |
| `mark_my_requests_seen()` | authenticated | Clears `customer_unseen` on the caller's rows **that existed when it was called** (`created_at <= now()` and changed no later than the call start; Decision 18), so a change committed during the call is not lost. |
| `claim_push_batch(p_limit int)` | service_role | Applies settings, staleness, throttle and collapse; returns messages `{ outbox_ids, event, kind, request_id, side, business_name, count, tokens: [{id, token}] }`. Never returns a note, order text, address, email, phone or customer name. |
| `record_push_results(p_results jsonb)` | service_role | Marks sent / retry / failed, stores tickets, deletes `DeviceNotRegistered` tokens. |
| `claim_push_receipts(p_limit int)` / `record_push_receipts(p_results jsonb)` | service_role | Receipt round. |
| `submit_pickup_request(...)`, `submit_table_request(...)` (changed) | authenticated | Daily cap, above. Signatures unchanged. |
| `private.flag_customer_unseen()`, `private.enqueue_request_event()`, `private.invoke_push_sender()`, `private.cleanup_push_outbox()` | none | Seen-flag trigger, event trigger, kick, cleanup. |

### Function privileges (CLAUDE.md, §16)
`supabase/tests/05-seller-onboarding.test.sql`: the `authenticated` allowlist gains `register_push_token`, `unregister_push_token`, `get_notification_settings`, `set_notification_settings`, `count_my_request_updates`, `mark_my_requests_seen`; message "specs 05 to 12"; the private-schema function list gains the four private functions (`flag_customer_unseen`, `enqueue_request_event`, `invoke_push_sender`, `cleanup_push_outbox`). The four service-role functions are asserted not executable by `anon` or `authenticated`.

## Storage
None.

## Edge Functions
**`push-sender`** (PR 1), `supabase/functions/push-sender/{index,handler,rpc}.ts`, same shape as `places-refresh` (`index.ts` wires real dependencies into a pure `createHandler(deps)`; shared `_shared/http.ts`).
- **Auth:** `verify_jwt = false` in `config.toml`; the handler requires the `x-cron-secret` header to equal `PUSH_SENDER_SECRET` (401 with no body on mismatch, 500 `not_configured` when unset).
- **Secrets** (Edge Function secrets, set by Archan, never in the repo, `.env` or logs): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUSH_SENDER_SECRET`, optional `EXPO_ACCESS_TOKEN` (Expo's enhanced push security). Vault secrets `push_sender_url`, `push_sender_secret` (set by Archan).
- **Input:** none (empty JSON). **Output:** `{ sent, skipped, retried, failed, receipts }` counts only.
- **Flow:** `claim_push_batch(100)` → texts from `_shared/pushText.ts` → POST `https://exp.host/--/api/v2/push/send` in chunks of at most 100 → `record_push_results` → `claim_push_receipts` → POST `/getReceipts` → `record_push_receipts`. One run is bounded (a few batches) and returns.
- **Message:** `{ to, title, body, sound: 'default', channelId: 'requests', priority: 'high', data: { v: 1, kind, id, side } }`. No `badge`, no user id, no note.
- **Logging (Decision 20):** only outbox ids, event names, counts and Expo error codes. **Logs and error messages never contain a token, a title or body text, or a note**, including on thrown errors (errors are mapped to codes before logging).
- **Texts** (`_shared/pushText.ts`, Decision 2), `{Place}` is the business name trimmed and cut to 40 characters, `{kind}` is "pickup" or "table":

| Event | Title | Body |
|---|---|---|
| new pickup | New pickup request | Open LikeToOrder to answer it. |
| new table | New table request | Open LikeToOrder to answer it. |
| collapsed new | New requests | You have {n} new requests waiting. |
| accepted | Request accepted | {Place} accepted your {kind} request. |
| declined | Request declined | {Place} declined your {kind} request. |
| expired | Request expired | {Place} didn't answer your {kind} request in time. |
| cancelled | Request cancelled | A customer cancelled a {kind} request. |
| collapsed cancelled (count > 1) | Requests cancelled | {n} requests were cancelled. |
| arrived | Customer has arrived | A customer with a table request is here. |

## Components & hooks
All in `src/features/notifications/` unless noted. Routes stay thin.
- `api.ts` — `registerPushToken`, `unregisterPushToken`, `getNotificationSettings`, `setNotificationSettings`, `countMyRequestUpdates`, `markMyRequestsSeen` (the last two may live in `src/features/requests/api.ts`; the plan decides by where the hook lives).
- `schema.ts` — strict zod payload schema (`v` 1, uuid `id`, `kind` enum, `side` enum, no extra keys), settings schema.
- `pushModule.ts` — the one wrapper over `expo-notifications` and `expo-device`: permission read and request, token (with the EAS `projectId` from `Constants.expoConfig.extra.eas.projectId`), listeners, Android channel `requests`. **No `projectId` or `Device.isDevice === false` → returns no token and registers nothing, without throwing** (Decision 19).
- `hooks/usePushRegistration.ts` — when signed in and permission granted: get the token and register it; again on app start, after sign-in and when the token changes.
- `hooks/useNotificationPermission.ts` — `undetermined | granted | denied`, refreshed on app focus.
- `hooks/useNotificationSettings.ts`, `hooks/useSetNotificationSetting.ts` — read and optimistic save, rollback on error.
- `hooks/useNotificationTaps.ts` — cold and warm taps → `/notifications/open` with the validated payload.
- `hooks/useForegroundRefresh.ts` — a push received in the foreground invalidates `requests.mine`, `inboxAll`, `waitingCount`, the updates count and that request's detail (stale-list rule); the banner is shown (Decision 13).
- `hooks/usePrimerMoment.ts` — decides when to open the primer (Decision 7): after a customer's first successfully sent request (pickup or table), and for an owner after onboarding finishes or on first opening Received; only while permission is `undetermined` and the person has not tapped Not now (kept per user in AsyncStorage). Never at launch.
- `components/NotificationsPrimer.tsx`, `components/NotificationSettingsScreen.tsx`, `components/NotificationsRow.tsx`, `components/NotificationOpenResolver.tsx`.
- `src/features/requests/hooks/useCustomerUpdates.ts` (change) — the count comes from `count_my_request_updates`; opening Sent calls `mark_my_requests_seen` then invalidates the count.
- `src/features/requests/hooks/useCancelPickupRequest.ts`, `useCancelTableRequest.ts` (change) — drop `markSeenAt` (the server does not flag an own cancel).
- `src/features/auth/hooks/useSignOut.ts` (change) — `unregisterPushToken` first (best effort, 3 s timeout, never blocks sign-out), then `signOut`.
- `src/features/auth/components/AuthProvider.tsx` (change) — no `clearStatusMemory` import; old `liketoorder.requests.seen.v1.*` AsyncStorage keys removed once.
- Reused: `NavRow`, `LabelledSwitch`, `Screen`, `ErrorState`, `Button`, `returnTo`, `useMyBusiness`, `TabBadge`.

## Files to create
**PR 1**
- `supabase/migrations/<timestamp>_notifications.sql`
- `supabase/tests/12-notifications.test.sql`
- `supabase/functions/push-sender/{index,handler,rpc}.ts`, `supabase/functions/_shared/{pushText,expoPush}.ts`
- `supabase/functions/tests/{push-sender,pushText}.test.ts`

**PR 2**
- `app/profile/notifications.tsx`, `app/notifications/{_layout,allow,open}.tsx`
- `src/features/notifications/{api,schema,pushModule}.ts`, `hooks/*`, `components/*`, `__tests__/*`

## Files to change
**PR 1**
- `src/types/database.ts` — regenerate with `npm run db:types`
- `supabase/config.toml` — `[functions.push-sender]` with `verify_jwt = false`
- `.claude/skills/supabase-patterns/SKILL.md` — the outbox, triggers, kick and service-role function pattern
- `docs/product/v1.md` — §16: fix the out-of-date "one customer can send up to 10 requests an hour to the same cook" line (it is 10 per place per 24 hours since 11b) (Decision 22); hosted-extensions item gains the `push-sender` and `push-outbox-cleanup` jobs; changelog
- **Forced edit to an older pgTAP test (approved):** `supabase/tests/05-seller-onboarding.test.sql` — allowlist, message, private-function list. If any older pgTAP fixture submits more than 30 requests through a submit function in 24 hours, **stop and ask**.

**PR 2**
- `package.json` / lock — via `npx expo install`
- `app.config.ts` — `expo-notifications` plugin; Android channel; `extra.eas.projectId` read from config when present (Decision 19)
- `jest.setup.ts` — faithful fakes for `expo-notifications` and `expo-device`
- `app/_layout.tsx` — mount `useNotificationTaps`, `useForegroundRefresh`, `usePushRegistration`, the notification handler
- `src/features/auth/hooks/useSignOut.ts`, `src/features/auth/components/AuthProvider.tsx`
- `src/features/profile/components/ProfileScreen.tsx`
- `src/features/requests/{api.ts}` (`daily_limit` mapping: "You've sent a lot of requests today. Try again tomorrow."), `hooks/{useCustomerUpdates,useCancelPickupRequest,useCancelTableRequest,useSubmitPickupRequest,useSubmitTableRequest}.ts`, `components/RequestsTabScreen.tsx`
- `src/features/requests/statusMemory.ts` — **deleted**
- `docs/product/v1.md` — §4 (the badge is server-side), §12, §16 (close: cancel-after-accept now possible later, daily cap and throttling, per-phone badge; add the real-device items), changelog
- `CLAUDE.md` — status table
- **Forced edits to older app tests (approved):** `statusMemory.test.ts` (deleted with the module), `requestsBadge.test.tsx`, `tableBadges.test.tsx`, `useCancelTableRequest.test.tsx` and the pickup cancel test (no `markSeenAt`), `RequestsTabScreen.test.tsx`, `SentFilters.test.tsx`, `RequestsTab.test.tsx` (badge source), `AuthProvider.test.tsx` (no `clearStatusMemory`), sign-out tests (the unregister call), `ProfileScreen` tests only if they pin the list of rows. **Anything beyond this list: stop and ask.**

## New dependencies
- `expo-notifications` — notification permission, Expo push token, tap and receive listeners, Android channel.
- `expo-device` — `isDevice`, so the Simulator never asks for a token.

Install with `npx expo install expo-notifications expo-device`. **Native rebuild required:** Archan runs `npx expo run:ios` after gate E. Expo push tokens work only on a real phone (and need the EAS `projectId` and APNs credentials, Decision 15).

## Rules for implementation
- RLS on every new table + pgTAP test
- Supabase calls only in `src/features/<x>/api.ts`
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility labels on every touchable
Feature-specific:
- **Privacy of texts.** A notification's title, body and data never contain a request note, response note, order text, address, email, phone number or customer name. Texts come only from the fixed templates; the only variable parts are the place name, the kind word and a count.
- **No secrets.** No `service_role` key in the app. No real push token, Expo access token or vault value in the repo, `.env`, fixtures or logs (fixtures use obviously fake tokens such as `ExponentPushToken[test-0001]`). Never read `.env`.
- **Outbox in the same transaction.** Events are written by the triggers, never by the app or the Edge Function. The trigger never raises for delivery reasons.
- **Server decides.** Throttling, collapsing, settings and the seen flag are all applied in SQL by the server clock.
- **pgTAP independence (Decision 21).** No pgTAP test depends on `pg_net`, vault secrets or a reachable Edge Function; the kick is a quiet no-op when they are missing, and pgTAP asserts outbox rows directly.
- **Migrations are append-only.** `npm run db:types` after the migration.
- **SQL hygiene.** ASCII-only SQL; escaped code points for any character class; `is distinct from` in NULL-sensitive checks.
- **Stale lists.** A foreground push, opening Sent and every request action invalidate the lists, counts and detail.
- **Never show a pending request as confirmed**, including notification text and the primer.
- **Faithful fakes.** `expo-notifications` and `expo-device` fakes in `jest.setup.ts` follow the `expo-location` pattern (real enum names, `jest.fn` defaults, a test-only `__emit` for listeners); own `QueryClient` per test (`retry: false`, `gcTime: 0`) with `cleanup()` and `client.clear()` in `afterEach`; every RNTL v14 call awaited; `waitFor`, never fixed timers.
- **Do not edit older tests beyond the approved lists.**
- **Accessibility.** Primer and settings: labels, roles, switch state as words, targets ≥ 44 pt, titles capped, no fixed heights; respect reduce-motion for the modal.
- Stage gates with a commit after each (stop and commit after each gate; no edits before "approved"):
  - PR 1: **A** migration + types → **B** pgTAP + approved pgTAP edit + SQL breaks → **C** `push-sender` + Deno tests + breaks, `config.toml` → **D** skill and docs (including the §16 fix, Decision 22), review, CI, merge.
  - PR 2: **E** deps, `app.config.ts`, fakes, api and schema, registration, sign-out → *Archan rebuilds* → **F** primer, permission, Profile settings → **G** tap resolver, foreground refresh, badge swap → **H** Simulator run, review, ship.

## Known pitfalls (checklist)
- [ ] **Badge flood on release:** existing rows start with `customer_unseen = false` (pgTAP).
- [ ] **Lost change during mark-seen:** `mark_my_requests_seen` clears only rows that existed (and had changed) when it was called (pgTAP).
- [ ] **Rolled-back change sends nothing:** no outbox row and no kick survive a rollback (pgTAP inside a savepoint).
- [ ] **Own cancel is not an update** for the server seen flag (pgTAP), and the app's cancel hooks no longer write local memory (jest).
- [ ] **Token moves between users** on the same phone; the old user gets no more pushes (pgTAP).
- [ ] **Sign-out order:** unregister before sign-out; a failed unregister does not block sign-out (jest).
- [ ] **No projectId / Simulator:** registers nothing and does not throw (jest).
- [ ] **Wrong-account tap** never lands on `/seller/onboarding` or shows another person's data (jest).
- [ ] **Leaked text in logs:** Deno test captures every log and error line (Decision 20).
- [ ] **pg_net absent in tests:** pgTAP passes with no vault secrets and no `pg_net` call made (Decision 21).
- [ ] **Leftover seed data breaks pgTAP counts:** own fixtures, counts only own rows, rolled back.
- [ ] **Test QueryClient cleanup** and AsyncStorage mock reset per test.
- [ ] **Old tests untouched** except the approved lists (`git diff --stat` on test files in the review).

## Out of scope
- Email or SMS notifications; an in-app notification inbox or history; read receipts.
- An app-icon badge (Decision 10); quiet hours (Decision 5).
- Cancel after acceptance (still not allowed; now possible in a later spec because the seller can be notified).
- Pushes for completed / no-show to the customer, and expiry pushes to the seller (Decision 1).
- Promotion or marketing pushes (spec 16).
- Removing or focus-gating the 30 s polling (Decision 16; §16 note stays).
- Android FCM credentials and an Android device run (before launch, §16).
- A first-name field on profiles.
- Everything in v1 §3.

## Definition of done
- [ ] Each event in the trigger table writes exactly one outbox row with the right event, kind, request, business and recipient; completed / no_show write none; a rolled-back change writes none (pgTAP).
- [ ] `customer_unseen` is set by an answer, an expiry, completed and no_show, not by the customer's own cancel; existing rows start false; `count_my_request_updates` counts both kinds; `mark_my_requests_seen` clears only rows that existed when it was called (pgTAP).
- [ ] `claim_push_batch`: settings off → `setting_off`; no token → `no_token`; a no-longer-pending new request → `stale`; a second new request inside 5 minutes is held and then collapsed into one push with the right count (edges: 4:59 held, 5:00 due); cancel before the new-request push → both `cancelled_before_send`; the 21st push to one recipient in an hour → `throttled`, `arrived` exempt; returned messages contain no note, order text, address, email, phone or customer name (pgTAP key-set check).
- [ ] Retries: waits of 1, 2, 4 and 8 minutes after the 1st to 4th failure, `failed` on the 5th; a stuck `sending` row is reclaimable after 5 minutes; `DeviceNotRegistered` deletes the token; receipts recorded (pgTAP).
- [ ] Tokens: format check; register moves a token from another user; the 11th token drops the oldest; unregister removes only the caller's own (pgTAP).
- [ ] Daily cap: 29 and 30 accepted, the 31st refused with `daily_limit`, counting both kinds and all places and every status; an idempotent replay at the cap returns the original; the 11b limits behave as before (pgTAP).
- [ ] **An outsider cannot** read any row of `push_tokens` or `notification_settings`; write `push_tokens` directly (insert or update); remove another user's token with `unregister_push_token` (the token stays with its owner); read or change another user's settings; read or write the outbox or tickets; execute any service-role or private function as `anon` or `authenticated`; count or clear another user's seen flags. `anon` executes no `public` function (pgTAP).
- [ ] pgTAP passes with no vault secrets and without `pg_net` being called (Decision 21).
- [ ] Deno: every template, fed fixtures that carry a note, order text, address, email, phone and customer name, produces texts and data containing none of them; payload shape (no `badge`, no user id); chunking at 100; retry classification; secret check (401 / 500); **every captured log and error line contains no token, title, body or note** (Decision 20).
- [ ] jest: payload validation; tap routing for both sides, cold and warm; signed out → sign-in → the right screen; wrong account → neutral line, never `/seller/onboarding`; primer timing and Not now; permission states (undetermined, granted, denied → Open Settings); settings switches with optimistic save and rollback; sign-out unregisters first and still signs out when that fails; no `projectId` or the Simulator registers nothing and does not throw; badge from the server count; opening Sent clears it; foreground push invalidates the lists; `daily_limit` message.
- [ ] Every touchable has a label and role, targets ≥ 44 pt, state as words (jest + iOS Simulator).
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npx supabase test db` and the Deno tests pass; `src/types/database.ts` regenerated, not hand-edited.
- [ ] Specs 09 to 11c tests pass unedited except the approved lists.
- [ ] Byte and invisible-character checks: SQL and TS added for this spec hold no non-ASCII byte (`perl -ne 'print "$ARGV:$.: $_" if /[^\x00-\x7F]/'`, byte mode); markdown (this spec, `SKILL.md`, `v1.md`, `CLAUDE.md`) passes the spec 11 invisible-character class (`perl -CSD` with the widened class). Each command is first proved on a scratch file holding one such character (it must print that line).

## Test plan
- **Database tests (pgTAP)** in `supabase/tests/12-notifications.test.sql`: everything under Definition of done, own fixtures with fixed ids, `begin; ... rollback;`, the `pg_temp.as_user` impersonation style from spec 11, and time moved by updating fixture timestamps (no sleeps). No dependence on `pg_net` or vault.
- **Deno tests** in `supabase/functions/tests/push-sender.test.ts` and `pushText.test.ts`: fake Expo client and fake RPCs, the log-capture test.
- **Unit/component tests (jest):** `schema` (payload), `pushModule` with the fakes, `usePushRegistration`, `useNotificationPermission`, `useNotificationSettings` / `useSetNotificationSetting`, `useNotificationTaps` + `NotificationOpenResolver`, `useForegroundRefresh`, `usePrimerMoment`, `NotificationsPrimer`, `NotificationSettingsScreen`, `NotificationsRow`, `useSignOut` order, badge from the server.
- **Deliberate breaks** (each must turn a named test red, then be reverted; SQL breaks are applied inside the test transaction with `create or replace` wrapped in `lives_ok` and rolled back, never committed):
  1. SQL: drop the owner filter in `unregister_push_token` — the outsider test fails.
  2. SQL: skip the settings check in `claim_push_batch` — the `setting_off` test fails.
  3. SQL: set `customer_unseen` on the customer's own cancel — the own-cancel test fails.
  4. SQL: remove the 5-minute collapse window — the collapse test fails.
  5. SQL: drop the daily cap — the 31st-request test fails.
  6. SQL: let `mark_my_requests_seen` clear rows changed after the call started — the lost-change test fails.
  7. Deno: put `note` into a template — the privacy test fails.
  8. Deno: log the token on an Expo error — the log-capture test fails.
  9. Deno: add the user id to `data` — the payload test fails.
  10. App: skip the business check in the resolver — the wrong-account test fails.
  11. App: register a token when `isDevice` is false or `projectId` is missing — the Simulator test fails.
  12. App: sign out before unregistering — the order test fails.
- **Manual check, iOS Simulator (run by Archan, after the rebuild):** primer at each moment and Not now; the system prompt; denied → Open Settings; Profile row and the four switches; tap routing with `xcrun simctl push booted com.archanme1.liketoorder <file>.apns` (cold and warm, sent and received, signed out, wrong account, bad payload); a foreground push refreshes the lists and badge; the server badge across two simulators signed in as one customer; the `daily_limit` message; VoiceOver and the largest text size on the new screens.
- **Real device, before launch (§16):** `eas init` and APNs credentials; a real Expo token; an end-to-end send from the hosted project; lock-screen texts; receipts; uninstall → token removed; two phones one user; sign-out on one phone stops its pushes; Android FCM credentials, channel and TalkBack.

## Decisions
Decisions made by Archan when approving this spec (all recommended defaults approved as written, plus five additions):
1. **Events in v1:** owner — new request (both kinds), cancelled while pending, I've arrived; customer — accepted, declined, expired (expired was already in v1 §12). Later: completed / no-show to the customer, expiry to the owner, cancel after accept.
2. **Exact texts** as in the table under Edge Functions.
3. **Names:** the place name (cut to 40 characters) in customer pushes only; no customer name in owner pushes (there is no first-name field; `display_name` is free text).
4. **Settings:** four switches, "Answers to my requests", "New requests", "Cancelled requests", "Customer arrived" (the last three only for business owners); no master switch (the phone's setting is the master).
5. **No quiet hours** in v1.
6. **Throttle numbers:** new requests per owner, the first at once, then at most one push per 5 minutes with the rest collapsed into "{n} new requests"; cancellations the same, and dropped together with their new-request push if neither was sent; hard cap 20 pushes per recipient per hour (arrived exempt); overall daily cap of 30 requests per customer per rolling 24 hours, both kinds and all places together (`daily_limit`).
7. **Primer timing:** after a customer's first successfully sent request, and for an owner after onboarding finishes or on first opening Received; always reachable from Profile; Not now is not re-asked automatically; never at launch.
8. **Sender trigger:** a `pg_net` kick queued in the event's transaction, plus a 1-minute `pg_cron` sweeper for retries, held rows and receipts.
9. **Server-side seen flag now,** replacing `statusMemory`.
10. **No app-icon badge** (confirms 10b Decision 17).
11. **Tokens:** sign-out unregisters first (best effort); if that fails, the next sign-in on the phone moves the token and the tap resolver protects a wrong account; uninstall is caught by `DeviceNotRegistered`; tokens not re-registered for 60 days are deleted; at most 10 per user. `register_push_token` moves a token to whoever registers it, by design, so one phone can switch accounts (accepted at gate B; see v1 §16).
12. **Two PRs** (backend, app) with gates A to D and E to H.
13. **Foreground pushes** show the banner and refresh the lists and badge.
14. **Owners are notified with seller mode off** (Received works with seller mode off).
15. **EAS project and credentials:** Archan runs `eas init` (the non-secret `projectId`), sets APNs with `eas credentials`, and sets `EXPO_ACCESS_TOKEN`, `PUSH_SENDER_SECRET` and the two vault secrets; none of these values enter the repo or logs. These are before-launch real-device steps recorded in §16.
16. **Polling unchanged** in v1 (permission may be off).
17. **Existing request rows start with `customer_unseen = false`**, so there is no badge flood on release.
18. **`mark_my_requests_seen` clears only rows that existed when it was called.**
19. **A missing EAS `projectId` must not crash the app:** it registers nothing, the same as on the Simulator. `eas init` and APNs credentials are before-launch real-device steps in §16.
20. **`push-sender` logs and errors never contain a token, a text or a note;** a Deno test asserts it.
21. **No pgTAP test may depend on `pg_net` or vault secrets;** the kick is a quiet no-op when they are missing.
22. **PR 1 gate D fixes the out-of-date §16 line** "one customer can send up to 10 requests an hour to the same cook" (it is 10 per place per 24 hours since 11b), and the gate report says so.

### Mismatches between the product spec and the code (found while writing this spec)
- v1 §12 already listed customer "expired" as a v1 notification; the brief called it optional. Decision 1 keeps it.
- v1 §16 (homemade read function item) says up to 10 requests an hour to the same cook; since 11b it is 10 per place per 24 hours. Fixed in gate D (Decision 22).
- There is no first-name field; requests show `coalesce(display_name, username)` (Decision 3).
- `app.config.ts` has no EAS `projectId`, and there are no APNs or FCM credentials yet (Decisions 15, 19).
- `/seller/requests/[id]` redirects a user with no business to `/seller/onboarding` through `SellerScreenGate`, so notification taps go through the resolver.
- v1 §16 expects push to "replace most of this polling"; Decision 16 keeps polling for v1.
