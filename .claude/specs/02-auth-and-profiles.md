# Spec 02: Auth And Profiles

**Branch:** `feature/auth-and-profiles`
**Product spec:** `docs/product/v1.md` §4 (one account for everything), §11 (Profile), §15 Q4 (closed: auth method), §16 S1 + S2 (carried-forward review items)
**Plan mode:** required — adds the first table, RLS and triggers, adds dependencies, changes auth and root navigation, and touches well over ~5 files.
**Status:** ✅ Shipped

## Overview
After this ships, a person can:
- create a LikeToOrder account with email + password
- confirm their email with a 6-digit code
- sign in and out
- reset a forgotten password
- set up and edit their profile (display name, username, bio, city)
- see their profile with an initials avatar

Signed-out users only see the auth screens. This comes now because every later feature (seller mode, requests, food log) needs a signed-in user and a `profiles` row to hang data on. This spec also closes review items S1 (hardened auth config) and S2 (guard against tables shipping without RLS). Tabs come in spec 03; until then the signed-in home is a temporary screen showing the user's profile.

## Depends on
- 01 project-setup (✅ Shipped)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §4, §11 (Profile only), §15 Q4, §16
- This spec
- `.claude/skills/supabase-patterns/SKILL.md`
- `.claude/skills/liketoorder-ui/SKILL.md`
- `supabase/config.toml` (`[auth]`, `[auth.email]`, `[api]` sections only)
- `src/lib/supabase.ts`, `app/_layout.tsx`, `app/index.tsx`
- `src/components/ui/index.ts`, `src/components/ui/Button.tsx` (pattern for new `ui/` components)
- `supabase/tests/00_smoke.test.sql` (it gets replaced)

## User stories
- As a visitor, I can sign up with email + password so that I have one account for everything (customer and, later, seller).
- As a visitor, I get a 6-digit code by email and enter it in the app to confirm my address, so that only people who own an email address can create an account with it.
- As a visitor who didn't get the code, I can resend it (with a cooldown) so that I'm not stuck.
- As a user, I can sign in with email + password, and I stay signed in across app restarts.
- As a user who forgot my password, I can request a reset code by email, enter it, and choose a new password.
- As a new user, right after my first sign-in I set my display name and username so that my profile isn't blank.
- As a user, I can edit my display name, username, bio and city, and change my username any time.
- As a user, I see my initials in a circle as my profile picture.
- As a user, I can sign out.
- As a signed-in user, I can view another user's public profile fields (later specs use this for the food log and requests).

## Screens & routes
Route groups are guarded in `app/_layout.tsx` with `Stack.Protected` (expo-router), based on three things:
1. whether there is a session
2. whether `isRecovering` is set (see Rules: Recovery session)
3. whether the profile is complete (this guard is added in stage 3)

- `app/(auth)/_layout.tsx` — stack for the auth screens — signed-out only
- `app/(auth)/sign-in.tsx` — email, password, "Sign in", links to sign-up and forgot password — signed-out only
- `app/(auth)/sign-up.tsx` — email, password (with a live rule hint: ≥ 8 chars, letters + digits), confirm password, "Create account" → goes to verify-email — signed-out only
- `app/(auth)/verify-email.tsx` — signed-out only
  - "Check your email" text and a 6-digit code field, with a "Confirm" button.
  - "Resend code" with a 60 s cooldown shown as a countdown in text, not only by a disabled color.
  - A neutral hint, shown for every email (new or existing): "Didn't get a code? If you already have an account, try signing in or resetting your password." The hint links to sign-in and forgot-password.
- `app/(auth)/forgot-password.tsx` — email, "Send reset code". It always shows the same neutral message: "If an account exists for that email, we sent a code" — signed-out only
- `app/(auth)/reset-password.tsx` — two steps:
  1. Code, then "Verify".
  2. New password and confirm, then "Save password", plus a "Cancel" button.
  - Saving clears `isRecovering`, the user becomes signed in, and they see "Password updated".
  - Cancel signs out and clears `isRecovering`.
  - Access: signed-out, or recovery session (`isRecovering`).
- `app/setup-profile.tsx` — display name + username, "Continue". It shows when the user is signed in, `isRecovering` is false and `profiles.username is null`. It can't be skipped — signed in, profile incomplete
- `app/index.tsx` — TEMPORARY signed-in home, replaced by tabs in spec 03. Shows `ProfileHeader` (Avatar, display name, @username, bio, city), "Edit profile" and "Sign out" — signed in, profile complete
- `app/profile/edit.tsx` — edit form for display name, username, bio, city; Save / Cancel — signed in, profile complete

Every screen that loads data handles loading / empty / error (with retry) / success. The forms show field errors inline and server errors in a banner.

## Database changes
One migration, created with `npx supabase migration new auth_and_profiles`:

```sql
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique
               check (username ~ '^[a-z0-9_]{3,20}$'),          -- lowercase only; null until setup
  display_name text check (char_length(btrim(display_name)) between 1 and 50),
  bio          text not null default '' check (char_length(bio) <= 160),
  city         text not null default '' check (char_length(city) <= 60),
  is_seller    boolean not null default false,                  -- flipped only by spec 05's function
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Row is created by the server when the auth user is created, never by the client.
create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at is always set by the server.
create function public.set_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
```

**Grants (column-level, explicit):**
```sql
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, bio, city) on public.profiles to authenticated;
-- no insert / delete grants: insert is trigger-only, delete cascades from auth.users
```

**RLS policies on `profiles`:**
| Action | Who | Policy |
|---|---|---|
| select | `authenticated` | `using (true)`: any signed-in user can read every column (all are public profile data, Decision 7) |
| select | `anon` | none (no grant, no policy; Decision 1) |
| insert | nobody (client) | no policy; the security-definer trigger inserts |
| update | owner | `using (id = (select auth.uid())) with check (id = (select auth.uid()))`. The column grant blocks `id`, `is_seller`, `created_at` and `updated_at` |
| delete | nobody (client) | no policy |

**Status-transition functions:** none in this spec. `is_seller` has no client update grant. Spec 05 adds the function that turns seller mode on.

**`supabase/config.toml` (S1 hardening):**
- `[auth]`: `minimum_password_length = 8`, `password_requirements = "letters_digits"`
- `[auth.email]`: `enable_confirmations = true`, `secure_password_change = true` (keep `double_confirm_changes = true`)
- `[auth.email]`: `max_frequency = "60s"`, which matches the resend cooldown in the UI
- `[auth.email.template.confirmation]` and `[auth.email.template.recovery]` point to `./supabase/templates/confirmation.html` and `recovery.html`. Both templates show `{{ .Token }}` (the 6-digit code), not a link, so no deep links or redirect URLs are needed (Decision 4).
- `site_url` and `additional_redirect_urls` stay unchanged; the code flow doesn't use them.

**S2 guard:** replace `supabase/tests/00_smoke.test.sql` with `supabase/tests/00_rls_enabled.test.sql`.
- It asserts that the count of `public` tables with `relrowsecurity = false` is 0, and its failure message lists the offending tables.
- It runs in CI on every PR, so a future table without RLS fails the build.
- The explicit grants above follow the same principle.
- `auto_expose_new_tables` stays unchanged because the pgTAP check works on any CLI version. If planning finds the setting is supported in the pinned CLI (2.122.0), decide then whether to also set it to `false`.

After the migration, run `npm run db:types`.

## Storage
None. Avatar upload is out of scope, and the profile picture is initials only.

## Edge Functions
None.

## Components & hooks
Shared UI:
- `src/components/ui/TextField.tsx`
  - Label, value and error text.
  - `secureTextEntry` with a show/hide toggle that is ≥ 44pt and labelled.
  - `accessibilityLabel` comes from the label.
  - Works with react-hook-form (`value` / `onChangeText` / `onBlur`).
  - Errors show as text plus an icon or prefix, never by color alone.
- `src/components/ui/Avatar.tsx`
  - A circle with up to 2 initials from `display_name`. Falls back to the first letter of the username, then "?".
  - Background color and sizes come from tokens.
  - `accessibilityLabel` is "<name>'s profile picture". Not touchable.
- `src/components/ui/Banner.tsx`
  - Form-level server error (and notice) banner, used by the auth and profile forms.
  - `accessibilityRole="alert"`; text plus an icon or prefix, never color alone. Colors from tokens.
- `src/components/ui/index.ts` — add all three exports.

Auth (`src/features/auth/`):
- `api.ts` — thin wrappers over `supabase.auth.*`:
  - Functions: `signUp(email, password)`, `verifyEmailCode(email, code)`, `resendEmailCode(email)`, `signIn(email, password)`, `signOut()`, `requestPasswordReset(email)`, `verifyResetCode(email, code)`, `updatePassword(password)`.
  - Each maps Supabase errors to typed app errors: `invalid_credentials`, `email_not_confirmed`, `weak_password`, `invalid_code`, `rate_limited`, `network`, `unknown`.
  - `signUp` returns the same success result whether the email is new or already registered (see Rules: Existing email on sign-up).
- `schema.ts` — zod schemas:
  - `emailSchema`
  - `passwordSchema`: ≥ 8, at least one letter and one digit, mirroring the server
  - `signUpSchema` (includes the confirm-password match), `signInSchema`
  - `codeSchema`: 6 digits
  - `resetPasswordSchema`
- `components/AuthProvider.tsx` — React context that exposes `{ session, isLoading, isRecovering }`:
  - Holds the `session` from `getSession()` plus `onAuthStateChange`.
  - Sets `isRecovering` as described in Rules: Recovery session.
  - Clears the react-query cache on sign-out.
- `hooks/useSession.ts` — reads the context.
- React-query mutation hooks: `hooks/useSignUp.ts`, `useSignIn.ts`, `useSignOut.ts`, `useVerifyEmailCode.ts`, `useResendEmailCode.ts`, `useRequestPasswordReset.ts`, `useVerifyResetCode.ts`, `useUpdatePassword.ts`.
- Forms built with react-hook-form and the zod resolver: `components/SignInForm.tsx`, `SignUpForm.tsx`, `VerifyEmailForm.tsx`, `ForgotPasswordForm.tsx`, `ResetPasswordForm.tsx`.

Profile (`src/features/profile/`):
- `api.ts`
  - Functions: `getProfile(id)`, `getMyProfile()`, `updateMyProfile(patch)`. The update sends only `username`, `display_name`, `bio` and `city`.
  - Maps the unique violation on `username` to `username_taken`, and check violations to field errors.
- `schema.ts` — zod schemas that match the DB checks exactly:
  - `usernameSchema`: trim, lowercase, `^[a-z0-9_]{3,20}$`, not a reserved name (Decision 8)
  - `displayNameSchema`: 1–50 after trim
  - `bioSchema`: ≤ 160
  - `citySchema`: ≤ 60, free text (Decision 6)
  - `setupProfileSchema`, `editProfileSchema`
- `hooks/useMyProfile.ts` — query key `['profile', 'me']`.
- `hooks/useProfile.ts` — query key `['profile', id]`.
- `hooks/useUpdateMyProfile.ts` — mutation; invalidates `['profile', 'me']` and `['profile', id]`.
- `components/ProfileHeader.tsx` — Avatar, display name, @username, bio, city. Bio and city lines are hidden when empty.
- `components/SetupProfileForm.tsx`, `components/EditProfileForm.tsx`.

## Files to create
- `supabase/migrations/<timestamp>_auth_and_profiles.sql`
- `supabase/migrations/<timestamp>_reserved_usernames.sql` (code review, Decision 8)
- `supabase/templates/confirmation.html`, `supabase/templates/recovery.html`
- `supabase/tests/00_rls_enabled.test.sql`
- `supabase/tests/02-auth-and-profiles.test.sql`
- `app/(auth)/_layout.tsx`, `sign-in.tsx`, `sign-up.tsx`, `verify-email.tsx`, `forgot-password.tsx`, `reset-password.tsx`
- `app/setup-profile.tsx`, `app/profile/edit.tsx`
- `src/components/ui/TextField.tsx`, `src/components/ui/Avatar.tsx`, `src/components/ui/Banner.tsx`
- Everything under `src/features/auth/` and `src/features/profile/` listed above
- Tests listed in the Test plan

## Files to change
- `supabase/config.toml` — S1 hardening and email templates (see Database changes)
- `supabase/tests/00_smoke.test.sql` — delete; replaced by `00_rls_enabled.test.sql` as planned in spec 01 Decision 3
- `supabase/seed.sql` — update the comment only; `/seed` seeds users
- `src/types/database.ts` — regenerate with `npm run db:types`, never by hand
- `src/lib/supabase.ts` — no change expected; it already has AsyncStorage, autoRefresh, the AppState listener and `detectSessionInUrl: false`
- `app/_layout.tsx`
  - Wrap the app in `AuthProvider`.
  - Add `Stack.Protected` guards for `(auth)`, `reset-password` (recovery) and the signed-in routes.
  - Stage 3 adds the `setup-profile` redirect.
  - Show a loading state while the session loads.
- `app/index.tsx` — replace the placeholder with the temporary signed-in home
- `src/components/ui/index.ts` — export `TextField`, `Avatar` and `Banner`
- `src/theme/tokens.ts` — add any missing tokens (avatar sizes, avatar background, error color if absent)
- `docs/product/v1.md`
  - Already updated by `/createspecs`: Q4 closed, §3 bullet, row 14 note, account deletion added to §16.
  - At ship time, mark S1 and S2 closed.
- `CLAUDE.md` — status row 02

## New dependencies
Install with `npx expo install`.
- `react-hook-form` — forms (already in the tech stack; first used here)
- `@hookform/resolvers` — zod resolver for react-hook-form

Nothing else is added. `expo-secure-store` (S3) is deliberately left out; S3 stays deferred to "before store release".

## Rules for implementation
Always include:
- RLS on every new table + pgTAP test
- Supabase calls only in `src/features/<x>/api.ts`
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility labels on every touchable

Feature-specific rules:
- **Staged implementation.** The plan and the build go in three stages, in order. Each stage's tests must pass before the next stage starts:
  1. **Database:** migration, `config.toml` (S1), email templates, `00_rls_enabled.test.sql` (S2), `02-auth-and-profiles.test.sql`, `npm run db:types`. Gate: `npx supabase test db`, `npm run typecheck`.
  2. **Auth flows:**
     - Build: `TextField`, `Banner`, `src/features/auth/*` including `AuthProvider` and `isRecovering`, the `(auth)` screens, and the root-layout guards.
     - The guards here cover only signed-in vs signed-out, plus the recovery session. While stage 2 is in progress, signed-in users reach the existing placeholder home.
     - Gate: auth jest tests, lint, typecheck, and a manual sign-up → verify → sign-in → reset run.
  3. **Profile screens:**
     - Build: `Avatar`, `src/features/profile/*`, setup-profile, the temporary home, and edit profile.
     - Add the setup-profile redirect to the root-layout guards now that the profile api exists.
     - Gate: profile jest tests, then the full `npm run lint && npm run typecheck && npm test && npx supabase test db`.
- **Recovery session:**
  - When `verifyResetCode` succeeds, Supabase issues a real session. The `PASSWORD_RECOVERY` event fires, or the auth event that `verifyOtp` emits for recovery; confirm which one in the supabase-js docs (context7) during planning.
  - The user must NOT be treated as signed in until `updatePassword` completes.
  - `AuthProvider` sets `isRecovering = true`. Set it directly from the successful `verifyResetCode` call, and also from the `PASSWORD_RECOVERY` event if one fires.
  - `isRecovering` is persisted in AsyncStorage so that a relaunch mid-recovery returns to reset-password.
  - While `isRecovering` is true, the route guard allows only `reset-password`. Setup-profile, home and edit profile can't be reached.
  - A successful `updatePassword` clears `isRecovering`. Cancel signs out and clears it.
- **Existing email on sign-up:**
  - Signing up with an already-registered email (confirmed or not) shows the same "Check your email" verify screen as a new email.
  - The UI never reveals whether the email exists. That covers wording, timing-visible states, and error banners.
  - With confirmations on, Supabase returns a user with no identities and no error for an existing email. `api.ts` must treat this exactly like a new sign-up.
  - "Resend code" for such an email also shows the neutral success state.
  - The verify screen always shows the same hint for every email: "Didn't get a code? If you already have an account, try signing in or resetting your password." That way an existing user has a path forward without the app revealing anything.
- `profiles` rows are created only by the `on_auth_user_created` trigger. The client never inserts into `profiles`.
- The client update payload contains only `username`, `display_name`, `bio` and `city`. `is_seller`, `id` and the timestamps are never sent; the DB grant enforces this anyway.
- The zod rules for username, display name, bio, city and password must equal the DB and auth-config rules. A test asserts the boundaries on both sides.
- **Never reveal whether an email is registered:**
  - Forgot-password always shows the same message.
  - Sign-in failures show "Email or password is incorrect".
  - The one exception is `email_not_confirmed`: route to verify-email with a resend option.
- Never log passwords, codes or session tokens (no `console.log` of auth payloads).
- **Field settings:**
  - Password fields: `secureTextEntry`, `autoComplete="password"` / `"new-password"`, and `textContentType` set, so iOS and Android password managers work.
  - Email fields: `keyboardType="email-address"`, `autoCapitalize="none"`.
  - Code field: `keyboardType="number-pad"`, `autoComplete="one-time-code"` / `textContentType="oneTimeCode"`.
- Use `verifyOtp` with the correct email OTP types for sign-up confirmation and recovery. Confirm the current type names in the supabase-js docs (context7) during planning, not from memory.
- Sign-out clears the react-query cache so no previous user's data is shown.
- `Stack.Protected` guards are for UX only. RLS is what protects the data.
- Avatar initials never rely on color alone; the initials text carries the meaning.
- Never read or edit `.env`.

## Out of scope
- Social sign-in (Google / Apple), magic links, phone/SMS auth (§15 Q4)
- Guest (signed-out) browsing; decide before spec 03 (Decision 1)
- Avatar / profile photo upload (initials only)
- Encrypting the persisted session with `expo-secure-store` (§16 S3, before store release)
- Account deletion (§16, before store release; Decision 5)
- Changing email address from the app, and changing password while signed in outside the reset flow
- Tabs, Profile tab, seller-mode tab (spec 03); seller mode switch and `is_seller` changes (spec 05)
- The seller "link to their business" on the profile (spec 05)
- Food log, activity grid and stats on the profile (specs 13–15)
- Admin role / `is_admin` (added with reports, spec 17)
- Configuring the remote Supabase project's SMTP and email templates. Archan does this in the dashboard; local development uses `[local_smtp]`.
- Anything in `docs/product/v1.md` §3

## Definition of done
**Sign-up and confirmation**
- [x] Sign-up with a valid email + password creates an `auth.users` row and exactly one `profiles` row (with `username` null). No session is issued until the email is confirmed.
- [x] Sign-up with an already-registered email (confirmed or unconfirmed) shows the same "Check your email" verify screen as a new email. No message, banner or state reveals that the email exists (component test with the api mocked + manual check).
- [x] The verify screen shows the exact same hint for new and existing emails: "Didn't get a code? If you already have an account, try signing in or resetting your password." (component test renders both cases and compares).
- [x] The confirmation email in the local mail UI (port 54324) contains a 6-digit code. Entering it signs the user in; a wrong code shows "That code isn't right".
- [x] "Resend code" is disabled for 60 s, with a visible countdown in text.
- [x] Passwords shorter than 8 characters, or without both a letter and a digit, are rejected by the form and by the server (`config.toml`).

**Sign-in and password reset**
- [x] Sign-in with wrong credentials shows a generic error. Sign-in with an unconfirmed email routes to verify-email.
- [x] Forgot-password shows the same message for registered and unregistered emails.
- [x] The reset code + new password flow works: the user can sign in with the new password and not the old one.
- [x] After the reset code is verified but before the new password is saved, the user can't reach home, setup-profile or edit profile. This holds after an app relaunch too. Cancel signs them out (component test on the guard / `AuthProvider` + manual check).

**Profile**
- [x] A freshly confirmed user lands on setup-profile and can't reach the home screen until display name and username are saved.
- [x] Choosing a taken username shows "Username is taken", case-insensitively (e.g. `Archan` vs `archan`).
- [x] Edit profile saves display name, username, bio and city. The home screen shows the change without a restart.
- [x] The Avatar shows correct initials ("Archan Me" → "AM"; a single word → "A") and has an accessibility label.

**Session**
- [x] Killing and reopening the app keeps the user signed in.
- [x] Sign-out returns to sign-in and clears cached profile data.

**Security (pgTAP)**
- [x] An outsider can't update another user's profile: the update affects 0 rows and the row is unchanged.
- [x] An outsider can't insert a `profiles` row, even for their own id (`throws_ok`, permission denied).
- [x] A user can't set their own `is_seller`, `id`, `created_at` or `updated_at` (permission denied on those columns).
- [x] Anon (signed-out) can't select any `profiles` rows.
- [x] No user can delete a `profiles` row; deleting the `auth.users` row cascades.
- [x] `updated_at` changes on update, and a client can't set it (there is no column grant).
- [x] The DB check constraints reject:
  - invalid usernames: `ab`, `has space`, `UPPER`, 21 characters
  - reserved usernames (Decision 8), e.g. `admin`, `support`, `liketoorder`
  - display names that are empty or whitespace only
  - bios over 160 characters
  - cities over 60 characters
- [x] `00_rls_enabled.test.sql` passes, and fails when a `public` table without RLS is created (verified once locally in a scratch transaction).

**Config, checks and docs**
- [x] `supabase/config.toml` has `minimum_password_length = 8`, `password_requirements = "letters_digits"`, `enable_confirmations = true` and `secure_password_change = true` (S1 closed).
- [x] Each of the three implementation stages had its tests passing before the next stage started (noted in the PR).
- [x] `npm run lint`, `npm run typecheck`, `npm test` and `npx supabase test db` all pass, and `src/types/database.ts` matches the generated types (the CI types diff is green).
- [x] Every touchable on the new screens has `accessibilityLabel` + `accessibilityRole` and is ≥ 44pt.
- [x] No colors or sizes are hardcoded outside tokens.
- [x] §16 S1 and S2 are marked closed in `docs/product/v1.md` at ship time.

## Test plan
**Unit and component tests (jest)** — all RNTL v14 calls are awaited.
- `src/features/auth/__tests__/schema.test.ts` — password, email, code and confirm-match boundaries.
- `src/features/profile/__tests__/schema.test.ts` — username, display name, bio and city boundaries, identical to the DB checks.
- `src/components/ui/__tests__/Avatar.test.tsx` — initials rules and the accessibility label.
- `src/components/ui/__tests__/TextField.test.tsx` — label, error text, and a labelled secure toggle ≥ 44pt.
- `src/features/auth/__tests__/SignInForm.test.tsx` — validation, generic error, unconfirmed email → verify route (api mocked).
- `src/features/auth/__tests__/SignUpForm.test.tsx` — for an existing-email response (user with no identities), it navigates to the same verify screen with the same copy as a new email.
- `src/features/auth/__tests__/VerifyEmailForm.test.tsx` — resend cooldown with fake timers; neutral result for every response; the hint text is identical for new and existing emails.
- `src/features/auth/__tests__/ForgotPasswordForm.test.tsx` — neutral message for every result.
- `src/features/auth/__tests__/ResetPasswordForm.test.tsx` — code step, then password step; Cancel calls sign-out.
- `src/features/auth/__tests__/AuthProvider.test.tsx` checks the recovery session:
  - After a successful `verifyResetCode` or a `PASSWORD_RECOVERY` event, `isRecovering` is true and the guard only allows reset-password.
  - The flag survives a remount (AsyncStorage mocked).
  - A successful `updatePassword` clears it.
  - Cancel signs out and clears it.
- `src/features/profile/__tests__/EditProfileForm.test.tsx` — `username_taken` maps to a field error; only the allowed fields are sent.
- `src/features/profile/__tests__/ProfileHeader.test.tsx` — loading, error with retry, success.

**Database tests (pgTAP)**
- `00_rls_enabled.test.sql` — no `public` table without RLS (S2).
- `02-auth-and-profiles.test.sql` checks:
  - RLS is enabled on `profiles`.
  - The trigger creates the profile on `auth.users` insert.
  - The owner can update the allowed columns; an outsider's update affects 0 rows.
  - Client insert and delete are denied; updates to `is_seller` and `created_at` are denied.
  - Anon select is denied; an authenticated user can select others' profiles.
  - The check constraints work, the username is unique case-insensitively, the trigger sets `updated_at`, and deleting the auth user cascades.

**Manual check on device**
- Run the full flow: sign-up → code from the local mail UI → setup profile → home → edit → sign out → sign in → forgot password → reset → sign in with the new password.
- Sign up again with the same email and confirm the screen and hint are identical.
- Verify a reset code, kill the app, relaunch, and confirm it returns to reset-password.
- Kill and relaunch while signed in and confirm the session persists.
- Do a VoiceOver pass on sign-in and edit profile.
- Confirm the password manager offers to save on sign-up.

## Decisions (approved 2026-11-01)
1. **Signed-out access:** sign-in is required for everything in spec 02. Signed-out users see only the auth screens, and `anon` can't read profiles. **Decide guest browsing before spec 03.**
2. **When username and display name are collected:** on a setup-profile screen after the first confirmed sign-in, not at sign-up.
3. **Username changes:** allowed any time if the new name is unique (lowercase `a-z 0-9 _`, 3–20 chars).
4. **Confirmation and reset:** 6-digit email codes entered in the app, not tappable links. No deep links or redirect URLs are needed.
5. **Account deletion:** not in this spec. Added to `docs/product/v1.md` §16 as "before store release".
6. **City:** free text, ≤ 60 characters.
7. **Profile visibility:** every profile field (display name, username, bio, city, `is_seller`) is readable by any signed-in user.
8. **Reserved usernames (added in the code review, 2026-11-02):** nobody can take `admin`, `administrator`, `support`, `help`, `staff`, `moderator`, `system`, `root` or `liketoorder`, so no one can pass as staff. Enforced by the `profiles_username_not_reserved` check in a follow-up migration (`<timestamp>_reserved_usernames.sql`) and by the same list in `usernameSchema`. The form shows "That username is reserved". Also recorded in `docs/product/v1.md` §11. Exact matches only: lookalike or impersonating usernames and display names (e.g. `liketoorder_team`, "LikeToOrder Support") are deferred to spec 17 (reports).
