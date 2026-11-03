# Spec 03: Navigation Shell

**Branch:** `feature/navigation-shell`
**Product spec:** `docs/product/v1.md` §4 (Navigation), §2 (Seller mode + Manage Business tab), §5 Homemade specifics (exact-address privacy, for the anon-access notes)
**Plan mode:** required — changes navigation and auth routing (guests can now reach part of the app), touches well over ~5 files, and adds a dependency (tab icons).
**Status:** 🚧 In progress

## Overview
After this ships, the app has its real navigation:
- bottom tabs **Restaurants · Homemade · Profile**
- a 4th tab, **Manage**, that appears only when `profiles.is_seller` is true
- **guests** (signed out) can open the app and browse the Restaurants and Homemade tabs without an account
- the Profile tab shows a "Sign in / Create account" prompt to guests, and the user's profile (moved from spec 02's temporary home, with Edit profile and Sign out) to signed-in users

Restaurants, Homemade and Manage show "coming soon" placeholders; specs 07, 08 and 10 fill them in. This comes now because every later screen needs a tab to live in, and the guest decision (spec 02 Decision 1) shapes how later specs set up anon read access.

## Depends on
- 01 project-setup (✅ Shipped)
- 02 auth-and-profiles (✅ Shipped)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §2, §4, §5 (Homemade specifics only)
- This spec
- `.claude/skills/liketoorder-ui/SKILL.md`
- `app/_layout.tsx`, `app/index.tsx`, `app/(auth)/_layout.tsx`, `app/profile/edit.tsx`
- `src/features/auth/routeAccess.ts`, `src/features/auth/components/AuthProvider.tsx`, `src/features/auth/hooks/useSession.ts`
- `src/features/profile/hooks/useMyProfile.ts`, `src/features/profile/components/ProfileHeader.tsx`
- `src/features/auth/__tests__/routing.test.tsx` (pattern for route-guard tests; its home assertions change)
- `src/components/ui/index.ts`, `src/components/ui/EmptyState.tsx`, `src/theme/tokens.ts`
- `supabase/tests/02-auth-and-profiles.test.sql` (pattern for the new pgTAP file)

## User stories
- As a visitor (guest), I can open the app and switch between the Restaurants and Homemade tabs without signing in, so that I can look around before making an account.
- As a guest, I see a "Sign in / Create account" prompt on the Profile tab, so that I know how to get an account.
- As a guest, I can leave the sign-in / sign-up screens and go back to browsing.
- As a signed-in user, I see my profile on the Profile tab, with Edit profile and Sign out.
- As a seller (`is_seller = true`), I see a 4th tab, **Manage**, whose screen is titled **Manage Business**.
- As a non-seller, I never see the Manage tab, and opening its route directly (deep link) sends me to Restaurants.
- As a user resetting my password, I still can't reach any tab until the new password is saved (spec 02 recovery guard).

## Screens & routes
Route groups stay guarded in `app/_layout.tsx` with `Stack.Protected`. The tab bar is `app/(tabs)/_layout.tsx` using expo-router `Tabs`.

- `app/(tabs)/_layout.tsx` — tab bar: Restaurants, Homemade, Profile, and Manage (seller only). Hides Manage when `is_seller` is false or there is no session. Planning confirms in the expo-router docs (context7) whether `Tabs.Protected` is available in `~58` and uses it; otherwise `href: null` plus a redirect in the screen.
- `app/(tabs)/restaurants.tsx` — header "Restaurants", `EmptyState` "The restaurant map is coming soon." — **public** (guest or signed-in)
- `app/(tabs)/homemade.tsx` — header "Homemade", `EmptyState` "Homemade food near you is coming soon." — **public**
- `app/(tabs)/profile.tsx` — **public**, content depends on session:
  - guest: `GuestProfilePrompt` — short line ("Sign in to see your profile, and later to send requests and log food.") + "Sign in" (primary) and "Create account" (secondary) buttons → `/sign-in`, `/sign-up`
  - signed in: the spec 02 temporary home moved here — password-updated `Banner`, `ProfileHeader`, sign-out error `Banner`, "Edit profile", "Sign out"
- `app/(tabs)/manage.tsx` — header "Manage Business", `EmptyState` "Your business tools are coming soon." — **seller** (signed in, profile complete, `is_seller = true`)
- `app/index.tsx` — no longer a screen; redirects to the home route (see below). Planning may instead make Restaurants the `(tabs)` index if that is cleaner, as long as the URL `/` lands on Restaurants.
- `app/profile/edit.tsx` — unchanged screen — signed in, profile complete. Planning checks that `/profile/edit` and the `/profile` tab don't clash in expo-router; if they do, move edit under the Profile tab's stack or rename the path.
- `app/(auth)/*` — unchanged forms. They are now reachable from the guest prompt, so sign-in and sign-up get a labelled back/close control that returns to the tabs.
- `app/setup-profile.tsx`, `app/(auth)/reset-password.tsx` — unchanged behaviour.

**Access rules** (extend `getRouteAccess` in `src/features/auth/routeAccess.ts`):
| State | `(tabs)` | Manage tab | `(auth)` sign-in/up | setup-profile | reset-password |
|---|---|---|---|---|---|
| guest (no session) | ✅ Restaurants, Homemade, Profile (prompt) | ❌ | ✅ | ❌ | ✅ |
| recovering (`isRecovering`) | ❌ | ❌ | ❌ | ❌ | ✅ only |
| signed in, profile incomplete | ❌ (forced to setup-profile, as in spec 02) | ❌ | ❌ | ✅ | ❌ |
| signed in, profile complete, not seller | ✅ | ❌ | ❌ | ❌ | ❌ |
| signed in, profile complete, seller | ✅ | ✅ | ❌ | ❌ | ❌ |

**Home route** (`getHomeRoute`): recovering → `/reset-password`; profile incomplete → `/setup-profile`; otherwise → `/restaurants` (cold start for guests and signed-in users).

**Landing after auth events** (Decisions 1–3):
- **After sign-in** (including the first sign-in after email confirmation, once setup-profile is done) → the Profile tab (`/profile`).
- **After sign-out** → stay on the Profile tab, which now shows the guest prompt. No redirect to sign-in.
- **After a successful password reset** → the Profile tab, where the "Password updated" banner shows.
- **Reset Cancel** (signs out) → the Profile tab guest prompt, same as sign-out.

The Profile tab loads data, so it handles loading / empty / error (with retry) / success (via `ProfileHeader`). The placeholder tabs have no data; they render the success state only.

## Database changes
No schema changes. No new tables, columns or functions.

New pgTAP regression file `supabase/tests/03-navigation-shell.test.sql`, because the app now runs real sessions as `anon`:
- `anon` has no privileges on `public.profiles` (select / insert / update / delete all denied).
- `anon` holds no table privileges on any `public` table, except an explicit allowlist that is empty today. Later specs (see "Anon access for guests" below) add their public tables to the allowlist in the same PR that grants them, so a grant to `anon` can't slip in by accident.

### Anon access for guests (notes for later specs)
Guests browse as the `anon` role. Each later spec must grant exactly what guests need and no more, with a pgTAP test for both sides.

**Needs anon read (select only):**
| Spec | Data | What guests may read |
|---|---|---|
| 04 cuisine-catalog | `cuisines` | all rows (name, flag, neutral icon) |
| 05 seller-onboarding | businesses / listings | public listing fields only: name, type, cuisine, **approximate** location for homemade, exact location for restaurants, whether table requests are accepted |
| 06 menu-management | menu items, menu photos (storage) | public menu fields, availability, menu photos (bucket read for listed businesses) |
| 07 / 08 maps | the same tables as 05 / 06 | read through the same policies; no extra grants |
| 16 promotions | active campaigns | only "is this seller promoted now" (e.g. via a view or function), not prices or campaign admin fields |
| 17 reports | confirmed report count | the count per seller only (view or function), never report rows |

**Must stay private from guests (no anon access):**
- **Homemade exact addresses** — separate table, readable only by the owner and by customers with an **accepted** request (CLAUDE.md, §5). Guests never get a grant on it.
- `profiles` — stays `authenticated` only (spec 02 Decision 1/7) unless a later spec decides otherwise.
- Pickup and table requests (spec 09–11), push tokens (12), food-log uploads including public ones (13; public uploads are visible to signed-in users only, Decision 5), report rows (17).
- Any write: guests can't insert, update or delete anything. Request buttons in later specs send guests to sign-in.

## Storage
None.

## Edge Functions
None.

## Components & hooks
Navigation (`src/features/navigation/`, new feature folder):
- `components/TabIcon.tsx` — icon for a tab; shows a filled vs outline shape for focused vs not, so focus isn't shown by color alone; colors from tokens.
- `components/TabLabel.tsx` — always-visible tab label; bold when focused, regular otherwise (`tabBarLabelStyle` can't vary by focus).
- `components/ComingSoon.tsx` — wraps `Screen` + `EmptyState` with a title and message; used by the three placeholder tabs.
- `hooks/useIsSeller.ts` — derives `isSeller` from `useMyProfile` (false for guests and while loading); used by the tab layout and the Manage route.

Profile (`src/features/profile/`):
- `components/GuestProfilePrompt.tsx` — guest message + "Sign in" and "Create account" buttons.
- `components/ProfileScreen.tsx` — the signed-in Profile tab content moved from `app/index.tsx` (banners, `ProfileHeader`, Edit profile, Sign out).

Auth (`src/features/auth/`):
- `routeAccess.ts` — add guest tabs access, the `manage` rule and the new home route (table above).
- `hooks/useCloseAuth.ts` — the Close control's action on sign-in / sign-up: pop the whole `(auth)` group from the root stack if possible (Decision 19), else `/restaurants`.

No new api functions; `is_seller` already comes back from `getMyProfile()`.

## Files to create
- `app/(tabs)/_layout.tsx`, `restaurants.tsx`, `homemade.tsx`, `profile.tsx`, `manage.tsx`
- `src/features/navigation/components/TabIcon.tsx`, `TabLabel.tsx`, `ComingSoon.tsx`
- `src/features/navigation/hooks/useIsSeller.ts`
- `src/features/profile/components/GuestProfilePrompt.tsx`, `ProfileScreen.tsx`
- `supabase/tests/03-navigation-shell.test.sql`
- Tests listed in the Test plan

## Files to change
- `app/_layout.tsx` — add the `(tabs)` group to the guards; guests can reach it; recovery and incomplete profile still can't; remove the old `index` / home guard entry.
- `app/index.tsx` — replace the temporary home with a redirect to the home route (or remove, see Screens & routes).
- `app/(auth)/_layout.tsx` and/or the sign-in / sign-up screens — back/close control to the tabs.
- `src/features/auth/routeAccess.ts` — new access rules and home route.
- `src/features/auth/__tests__/routing.test.tsx` — home assertions move from `/` to the Profile tab / `/restaurants`; add guest cases.
- `src/features/auth/__tests__/AuthProvider.test.tsx` — only if its `getRouteAccess` assertions change.
- `src/theme/tokens.ts` — tab bar tokens if missing (active / inactive tint, bar background, icon size).
- `docs/product/v1.md` — §4: guests can browse Restaurants and Homemade; sign-in required for Profile, seller mode and requests; the 4th tab is labelled "Manage" with screen title "Manage Business". Changelog line.
- `CLAUDE.md` — status row 03.

## New dependencies
Install with `npx expo install`.
- `@expo/vector-icons` — tab bar icons (Ionicons: restaurant, home, person, storefront). Already part of the Expo SDK; it is not in `package.json` today, so importing it needs an explicit dependency (Decision 4).
- `expo-font` and `expo-asset` — required peers of `@expo/vector-icons` (it loads its icon font through `expo-font`, which needs `expo-asset`). Without them at the top level, both Metro and jest fail to resolve `expo-asset`.

## Rules for implementation
Always include:
- RLS on every new table + pgTAP test (no new tables; the new pgTAP file guards anon privileges)
- Supabase calls only in `src/features/<x>/api.ts`
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility labels on every touchable

Feature-specific rules:
- **Recovery guard stays.** While `isRecovering` is true, only `reset-password` is reachable — no tab, not even the public ones. The existing spec 02 tests for this keep passing.
- **Setup-profile stays mandatory.** A signed-in user with `username is null` can't reach the tabs (guest-only browsing doesn't apply to them).
- **Manage tab is UX only.** Hiding the tab and redirecting the route are not security; spec 05+ protects seller data with RLS. The Manage screen in this spec shows no data.
- `is_seller` comes from `useMyProfile` (`['profile','me']`). No new query and no client write to `is_seller` (spec 02 grant already blocks it). When the profile query refetches with a changed `is_seller`, the tab bar updates without a restart.
- A non-seller (or guest) opening `/manage` directly is redirected to `/restaurants`.
- **Guests make no Supabase data calls** in this spec (`useMyProfile` stays disabled without a session). Nothing on the placeholder tabs queries the database.
- Sign-out clears the react-query cache (spec 02) so the Manage tab disappears immediately.
- **Tab bar accessibility:** each tab has `tabBarAccessibilityLabel` (e.g. "Restaurants tab"), role tab, selected state announced, touch target ≥ 44pt, label text always visible (not icon only), focused state shown by icon shape + label weight, not color alone.
- No colors or sizes outside `tokens.ts`.
- Never show a pending request as confirmed and never show a homemade exact address (nothing in this spec shows either; placeholders only).

### Testing seller mode by hand (local only)
Spec 05 adds the real seller switch. Until then:
1. `npx supabase start`, then open Supabase Studio at http://127.0.0.1:54323.
2. **Table Editor → `profiles`**, find your row by `username`, set `is_seller` to `true`, save. Or in **SQL Editor**:
   ```sql
   update public.profiles set is_seller = true where username = '<your_username>';
   ```
3. In the app, relaunch (or pull to refresh on Profile if planning adds it) so `['profile','me']` refetches. The **Manage** tab appears. Set it back to `false` to hide it.
This works only against local Supabase; it uses Studio's admin access, not the app's grants.

## Out of scope
- Real maps, markers, bottom sheets (specs 07, 08)
- Seller mode switch, business onboarding, the seller "link to business" on the profile (spec 05)
- Seller request inbox and any Manage Business content (spec 10)
- Any anon grants on tables (each later spec adds its own; see the notes above)
- Food log and activity grid on the Profile tab (specs 13–15)
- Request buttons and the "sign in to request" prompt (spec 09)
- Deep-link / universal-link configuration beyond what expo-router gives by default
- Account deletion, session encryption (§16, before store release)
- Anything in `docs/product/v1.md` §3

## Definition of done
**Guests**
- [ ] A signed-out user launching the app lands on the Restaurants tab and can switch to Homemade and Profile without signing in.
- [ ] A guest sees exactly 3 tabs; no Manage tab.
- [ ] The guest Profile tab shows the sign-in prompt with "Sign in" and "Create account"; each opens the right auth screen, and the back/close control returns to the tabs.
- [ ] A guest opening `/manage` directly is redirected to `/restaurants`.
- [ ] No Supabase data request is made while browsing as a guest (component test with supabase mocked asserts no `from('profiles')` call).

**Signed in**
- [ ] A signed-in user with a complete profile sees Restaurants · Homemade · Profile; the Profile tab shows their `ProfileHeader`, "Edit profile" and "Sign out".
- [ ] "Edit profile" opens edit profile; saving shows the change on the Profile tab without a restart.
- [ ] Signing in from the guest prompt lands on the Profile tab showing the user's profile (Decision 1).
- [ ] Sign-out clears cached profile data and the user stays on the Profile tab, which now shows the guest prompt; no redirect to sign-in (Decision 2).
- [ ] A signed-in user with no username is sent to setup-profile and can't reach any tab.
- [ ] Signed-in users are redirected away from sign-in / sign-up.

**Seller tab**
- [ ] With `is_seller = true`, a 4th tab labelled "Manage" appears and its screen title is "Manage Business".
- [ ] With `is_seller = false`, the tab is hidden and `/manage` redirects to `/restaurants`.
- [ ] Flipping `is_seller` in local Studio and refetching the profile shows / hides the tab without reinstalling (manual check, steps above).

**Recovery (spec 02 regression)**
- [ ] After a reset code is verified, no tab (public or not) is reachable until the new password is saved, including after a relaunch. Cancel signs out and lands on the Profile tab guest prompt.
- [ ] Saving the new password lands on the Profile tab with the "Password updated" banner visible (Decision 3).

**Security (pgTAP)**
- [ ] `anon` can't select, insert, update or delete `public.profiles`.
- [ ] `anon` has no table privileges on any `public` table (allowlist empty).
- [ ] `00_rls_enabled.test.sql` and `02-auth-and-profiles.test.sql` still pass.

**Quality**
- [ ] Every tab and button has `accessibilityLabel` + `accessibilityRole`, is ≥ 44pt, and the focused tab is distinguishable without color (VoiceOver announces "selected").
- [ ] No colors or sizes are hardcoded outside tokens.
- [ ] `docs/product/v1.md` §4 updated with the guest and "Manage" decisions.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npx supabase test db` all pass.

## Test plan
**Unit and component tests (jest)** — all RNTL v14 calls are awaited.
- `src/features/auth/__tests__/routeAccess.test.ts` — every row of the access table, including recovering and incomplete-profile cases, and `getHomeRoute`.
- `src/features/auth/__tests__/routing.test.tsx` (update) — real routes with supabase mocked:
  - guest cold start → `/restaurants`; can open Homemade and Profile; sees the guest prompt; `/manage` → `/restaurants`
  - complete profile → tabs; Profile tab shows `@archan` and the avatar label
  - incomplete profile → setup-profile; tabs unreachable
  - relaunch mid-recovery → reset-password; tabs unreachable
  - sign-out failure banner now asserted on the Profile tab
  - sign-in from the guest prompt → `/profile`; sign-out → stays on `/profile` with the guest prompt; password reset saved → `/profile` with the "Password updated" banner
- `src/features/navigation/__tests__/TabsLayout.test.tsx` — 3 tabs for guest and non-seller, 4 for seller with label "Manage"; Manage screen header "Manage Business"; tab accessibility labels and roles; tab bar updates when the mocked profile changes `is_seller`.
- `src/features/profile/__tests__/GuestProfilePrompt.test.tsx` — copy, both buttons navigate, labels and roles.
- `src/features/profile/__tests__/ProfileScreen.test.tsx` — loading, error with retry, success; Edit profile and Sign out actions.

**Database tests (pgTAP)**
- `03-navigation-shell.test.sql` — anon has no privileges on `profiles`; anon has no table privileges in `public` outside the (empty) allowlist.

**Manual check on device**
- Fresh install, signed out: browse Restaurants, Homemade, Profile; Sign in from Profile and back out of it.
- Sign up → setup profile → tabs; edit profile; sign out.
- Set `is_seller = true` in local Studio, refetch → Manage tab with "Manage Business"; set false → gone.
- Verify a reset code, kill the app, relaunch → reset-password, no tabs.
- VoiceOver pass over the tab bar and the guest prompt.

## Decisions (approved 2026-11-02)
1. **After sign-in:** land on the Profile tab. Revisit in spec 09, when signing in starts from a request button.
2. **After sign-out:** stay on the Profile tab, which shows the guest prompt. Replaces spec 02's redirect to sign-in.
3. **After a successful password reset:** land on the Profile tab so the "Password updated" banner is visible.
4. **Tab icons:** add `@expo/vector-icons` (Ionicons).
5. **Public food-log uploads (spec 13):** visible to signed-in users only, not guests, matching `profiles`.

### Plan decisions (approved 2026-11-02)
6. **Manage tab:** `Tabs.Protected guard={isSeller} redirectTo="/restaurants"` (available in expo-router `~58`); no `href: null` fallback.
7. **Access rules:** `getRouteAccess` gains `tabs` (guests + complete profiles, never mid-recovery) and `manage` (`app && isSeller`); `app` now covers only edit profile. `getHomeRoute` → `/restaurants` | `/setup-profile` | `/reset-password`.
8. **Post-auth landing:** new `getPostAuthRoute` (`/profile` when signed in with a complete profile) is the `redirectTo` for the `(auth)` and `setup-profile` guards, giving Decisions 1 and 3 without per-form navigation.
9. **Password reset notice:** after saving, the reset form navigates to `/profile?notice=password-updated`; `ProfileScreen` reads `notice` from the route params, with the session notice as fallback.
10. **Reset Cancel:** navigates to `/profile` after sign-out, because `reset-password` stays reachable for guests.
11. **`/` route:** `app/index.tsx` is a `<Redirect href="/restaurants" />`; `/profile` (tab) and `/profile/edit` coexist.
12. **Headers:** tab headers are off; each screen renders its own `h1` (like `AuthScreen`). Sign-in / sign-up get a "Close" control (label "Close and keep browsing") via `AuthScreen`'s `onClose`.
13. **Tokens:** only `size.tabIcon` added; tab colors use existing `primary`, `textMuted`, `surface`, `border`.
14. **Tab role on iOS:** the bundled bottom tab bar reports role "button" on iOS (library FIXME) but announces "selected"; accepted for now.
15. **Profile load after sign-in (found in testing):** the root layout blocks with a full-screen loader only on cold start. After sign-in or a password reset it keeps the Stack mounted under a loading overlay, because unmounting it dropped the navigation state and landed on `/restaurants` instead of `/profile`.
16. **Reset navigation callbacks (found in testing):** `useUpdatePassword` / `useSignOut` take a hook-level `onSuccess`; per-`mutate()` callbacks were dropped when clearing `isRecovering` unmounted the new-password step.
17. **Known, accepted limitation:** opening `/profile?notice=password-updated` by hand shows a harmless cosmetic "Password updated" banner; no code change.
18. **Known, accepted limitation (review Q2):** if the profile fails to load right after sign-in, the full-screen error replaces the Stack, so after Retry the user lands on `/restaurants` instead of `/profile`. Rare and harmless; no code change.
19. **Close after switching forms (review Q1):** sign-in pushes sign-up inside the `(auth)` stack, so `router.back()` returned to sign-in and `dismissTo('/restaurants')` / `dismissAll()` either lost the guest's tab or stayed in `(auth)`. `useCloseAuth` pops the `(auth)` group from the root stack instead, returning to the tab the guest came from.
