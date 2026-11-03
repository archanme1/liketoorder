# Spec 04: Cuisine Catalog

**Branch:** `feature/cuisine-catalog`
**Product spec:** `docs/product/v1.md` §5 Onboarding step 3, §6 (flag markers, neutral icon fallback), §11 Food log uploads (required country/cuisine) and Cuisine view, §14 row 04
**Plan mode:** required — adds a table, RLS policies, anon grants and a guard trigger (schema + RLS change).
**Status:** 🚧 In progress

## Overview
After this ships, the database holds one read-only list of 200 cuisines: 197 countries (all 193 UN member states plus Taiwan, Palestine, Hong Kong and Puerto Rico), each with an emoji flag, plus 3 neutral cuisines (Street food, Fusion, Other) that show an Ionicons icon instead of a flag. Guests and signed-in users can read the list. Nobody can change it from the app; only migrations change it, and a cuisine's code can never be renamed or reused. The app gets `listCuisines()` in a new `src/features/cuisines/api.ts` and two react-query hooks. There are no screens. This comes now because seller onboarding (05) and food-log uploads (13) both need a cuisine picker, and the maps (07, 08) and the grid's cuisine view (15) all show the same flags.

## Depends on
- 01 project-setup (✅ Shipped)
- 02 auth-and-profiles (✅ Shipped)
- 03 navigation-shell (✅ Shipped; owns the anon allowlist test this spec extends)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §5 (Onboarding), §6, §11 (Food log uploads, Cuisine view)
- This spec
- `.claude/skills/supabase-patterns/SKILL.md`
- `supabase/migrations/20261102033759_auth_and_profiles.sql` (revoke-then-grant pattern, trigger function revokes)
- `supabase/tests/03-navigation-shell.test.sql` (anon allowlist to extend)
- `supabase/tests/02-auth-and-profiles.test.sql` (pgTAP pattern, trigger function execute checks)
- `src/features/profile/api.ts`, `src/features/profile/hooks/useProfile.ts`, `src/features/profile/__tests__/api.test.ts` (api, error and test patterns)
- `src/lib/queryClient.ts`

## User stories
- As a visitor (guest), my app can load the cuisine list without signing in, so the maps can show flags to me.
- As a seller (spec 05), I can later pick my cuisine from one fixed list, so my marker shows the right flag.
- As a customer (spec 13), I can later tag each food-log upload with a cuisine from the same list, so my grid's cuisine view and "cuisines tried" stat line up with the map.
- As a screen-reader user, I always hear the country or cuisine name. A flag is never the only way the cuisine is shown.

## Screens & routes
None. Specs 05 and 13 build the pickers.

## Database changes
One migration, `npx supabase migration new cuisine_catalog`.

```sql
create table public.cuisines (
  code        text primary key,
  kind        text not null check (kind in ('country', 'neutral')),
  -- ICU English collation so accented names (Côte d'Ivoire, São Tomé and Príncipe, Türkiye) sort
  -- like their unaccented letters, whatever the database's default collation is.
  name        text collate "en-x-icu" not null unique check (char_length(name) between 1 and 40),
  -- Emoji flag derived from the ISO code (two regional-indicator symbols), so it can't drift from the code.
  flag        text generated always as (
                case when kind = 'country' then
                  chr(127397 + ascii(substr(code, 1, 1))) || chr(127397 + ascii(substr(code, 2, 1)))
                end) stored,
  icon        text,          -- Ionicons glyph name; neutral cuisines only
  sort_order  smallint not null,
  constraint cuisines_country_shape check (
    kind <> 'country' or (code ~ '^[A-Z]{2}$' and icon is null)),
  -- `icon is not null` is needed: a regex match on null is null, and a check passes on null.
  constraint cuisines_neutral_shape check (
    kind <> 'neutral' or (code ~ '^[a-z]+(-[a-z]+)*$' and icon is not null and icon ~ '^[a-z0-9-]+$'))
);

alter table public.cuisines enable row level security;

revoke all on public.cuisines from anon, authenticated;
grant select on public.cuisines to anon, authenticated;

create policy cuisines_select_all on public.cuisines
  for select to anon, authenticated using (true);
-- No insert / update / delete policies or grants: only migrations change this table.

-- Codes are permanent: never renamed, never reused. Blocking delete is what stops reuse.
create function public.cuisines_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'cuisine_code_permanent: rows are never deleted'; end if;
  if new.code <> old.code then raise exception 'cuisine_code_permanent: codes are never renamed'; end if;
  return new;
end $$;
create trigger cuisines_guard before update or delete on public.cuisines
  for each row execute function public.cuisines_guard();
revoke execute on function public.cuisines_guard() from public, anon, authenticated;

insert into public.cuisines (code, kind, name, icon, sort_order) values
  ('IT', 'country', 'Italy', null, 100),
  -- … all 197 countries below, sort_order 100 …
  ('street-food', 'neutral', 'Street food', 'fast-food-outline',                  900),
  ('fusion',      'neutral', 'Fusion',      'shuffle-outline',                    910),
  ('other',       'neutral', 'Other',       'ellipsis-horizontal-circle-outline', 999);
```

**Code:** `code` is the stable key and the primary key. Countries use the ISO 3166-1 alpha-2 code in upper case (`IT`). Neutral cuisines have no ISO code, so they use a lower-case kebab slug (`street-food`). The two formats can't collide. Later tables reference it as `cuisine_code text not null references public.cuisines(code) on update restrict on delete restrict`.

**Codes are permanent (Decision 1):** a code is never renamed and never reused for a different cuisine. The `cuisines_guard` trigger enforces this in the database, for migrations as well as the app. A code can't be changed and no row can be deleted, and since deleted codes are the only way a code could be reused, that blocks reuse too. `name`, `icon` and `sort_order` can still be updated by a later migration. Retiring a cuisine is out of scope for v1. If it is ever needed, a future spec adds an `is_active` column rather than deleting the row.

**Order:** the list sorts by `sort_order, name`. Every country has 100, so countries come out alphabetically. `name` uses the ICU English collation (`en-x-icu`), so accented names sort as a reader expects: Costa Rica, Côte d'Ivoire, Croatia; San Marino, São Tomé and Príncipe, Saudi Arabia; Tunisia, Türkiye, Turkmenistan. Under the plain `C` collation, Côte d'Ivoire would land after Croatia and Türkiye after Tuvalu. PostgREST's `.order('name')` follows the column's collation, so the app needs no extra code. Planning first checks that `en-x-icu` exists in the local Supabase image (`select 1 from pg_collation where collname = 'en-x-icu'`). If it doesn't, planning stops and raises it as a question; it does not quietly switch to sorting in the app. Street food has 900, Fusion 910 and Other 999, so the neutral rows come after the countries and Other is always last. Adding a country later is one insert with 100.

**Flag:** a generated column, so a migration can't store the wrong flag for a code. `chr`, `ascii` and `substr` are immutable, so Postgres allows them in a generated column.

**RLS / grants:**
| Role | select | insert | update | delete |
|---|---|---|---|---|
| anon | ✅ all rows | ❌ | ❌ | ❌ |
| authenticated | ✅ all rows | ❌ | ❌ | ❌ |

`cuisines_guard` is a trigger function, not a callable RPC. It gets the same execute revoke as the spec 02 trigger functions, with a pgTAP check. The general function-privilege allowlist from §16 stays with the first spec that adds a callable function. No status transitions.

### Country list (197) — Archan to review
The list is all 193 UN member states plus Taiwan, Palestine, Hong Kong and Puerto Rico. No other territories, and no non-member states such as the Holy See or Kosovo.

**Naming:** short English names.
- Where the UN/ISO short name is the one in common use, use it: Türkiye, Czechia, Cabo Verde, Eswatini, Timor-Leste, North Macedonia, Côte d'Ivoire, São Tomé and Príncipe.
- Where the UN formal name is long, use the common short form: Russia, Iran, Syria, Laos, Vietnam, Bolivia, Venezuela, Tanzania, Moldova, Brunei, Micronesia, North Korea, South Korea, United States, United Kingdom.
- The two Congos are "Congo" (CG) and "DR Congo" (CD).
- Three names have accents: Côte d'Ivoire, São Tomé and Príncipe and Türkiye.

Regions follow the UN geoscheme. Cyprus and Türkiye are under Western Asia. The region is only for this review and is not stored.

| Region | Countries (code) |
|---|---|
| **Africa (54)** | |
| Northern Africa (6) | Algeria DZ, Egypt EG, Libya LY, Morocco MA, Sudan SD, Tunisia TN |
| Western Africa (16) | Benin BJ, Burkina Faso BF, Cabo Verde CV, Côte d'Ivoire CI, Gambia GM, Ghana GH, Guinea GN, Guinea-Bissau GW, Liberia LR, Mali ML, Mauritania MR, Niger NE, Nigeria NG, Senegal SN, Sierra Leone SL, Togo TG |
| Middle Africa (9) | Angola AO, Cameroon CM, Central African Republic CF, Chad TD, Congo CG, DR Congo CD, Equatorial Guinea GQ, Gabon GA, São Tomé and Príncipe ST |
| Eastern Africa (18) | Burundi BI, Comoros KM, Djibouti DJ, Eritrea ER, Ethiopia ET, Kenya KE, Madagascar MG, Malawi MW, Mauritius MU, Mozambique MZ, Rwanda RW, Seychelles SC, Somalia SO, South Sudan SS, Tanzania TZ, Uganda UG, Zambia ZM, Zimbabwe ZW |
| Southern Africa (5) | Botswana BW, Eswatini SZ, Lesotho LS, Namibia NA, South Africa ZA |
| **Americas (36)** | |
| Northern America (2) | Canada CA, United States US |
| Caribbean (14) | Antigua and Barbuda AG, Bahamas BS, Barbados BB, Cuba CU, Dominica DM, Dominican Republic DO, Grenada GD, Haiti HT, Jamaica JM, Puerto Rico PR, Saint Kitts and Nevis KN, Saint Lucia LC, Saint Vincent and the Grenadines VC, Trinidad and Tobago TT |
| Central America (8) | Belize BZ, Costa Rica CR, El Salvador SV, Guatemala GT, Honduras HN, Mexico MX, Nicaragua NI, Panama PA |
| South America (12) | Argentina AR, Bolivia BO, Brazil BR, Chile CL, Colombia CO, Ecuador EC, Guyana GY, Paraguay PY, Peru PE, Suriname SR, Uruguay UY, Venezuela VE |
| **Asia (50)** | |
| Central Asia (5) | Kazakhstan KZ, Kyrgyzstan KG, Tajikistan TJ, Turkmenistan TM, Uzbekistan UZ |
| Eastern Asia (7) | China CN, Hong Kong HK, Japan JP, Mongolia MN, North Korea KP, South Korea KR, Taiwan TW |
| South-eastern Asia (11) | Brunei BN, Cambodia KH, Indonesia ID, Laos LA, Malaysia MY, Myanmar MM, Philippines PH, Singapore SG, Thailand TH, Timor-Leste TL, Vietnam VN |
| Southern Asia (9) | Afghanistan AF, Bangladesh BD, Bhutan BT, India IN, Iran IR, Maldives MV, Nepal NP, Pakistan PK, Sri Lanka LK |
| Western Asia (18) | Armenia AM, Azerbaijan AZ, Bahrain BH, Cyprus CY, Georgia GE, Iraq IQ, Israel IL, Jordan JO, Kuwait KW, Lebanon LB, Oman OM, Palestine PS, Qatar QA, Saudi Arabia SA, Syria SY, Türkiye TR, United Arab Emirates AE, Yemen YE |
| **Europe (43)** | |
| Eastern Europe (10) | Belarus BY, Bulgaria BG, Czechia CZ, Hungary HU, Moldova MD, Poland PL, Romania RO, Russia RU, Slovakia SK, Ukraine UA |
| Northern Europe (10) | Denmark DK, Estonia EE, Finland FI, Iceland IS, Ireland IE, Latvia LV, Lithuania LT, Norway NO, Sweden SE, United Kingdom GB |
| Southern Europe (14) | Albania AL, Andorra AD, Bosnia and Herzegovina BA, Croatia HR, Greece GR, Italy IT, Malta MT, Montenegro ME, North Macedonia MK, Portugal PT, San Marino SM, Serbia RS, Slovenia SI, Spain ES |
| Western Europe (9) | Austria AT, Belgium BE, France FR, Germany DE, Liechtenstein LI, Luxembourg LU, Monaco MC, Netherlands NL, Switzerland CH |
| **Oceania (14)** | Australia AU, Fiji FJ, Kiribati KI, Marshall Islands MH, Micronesia FM, Nauru NR, New Zealand NZ, Palau PW, Papua New Guinea PG, Samoa WS, Solomon Islands SB, Tonga TO, Tuvalu TV, Vanuatu VU |

Totals: Africa 54 + Americas 36 + Asia 50 + Europe 43 + Oceania 14 = **197** (193 UN members + 4). With the 3 neutral cuisines, that is **200 rows**.

The pgTAP test compares the full set of 197 codes with this list (`set_eq`), so a typo, a missing country or an extra territory fails. It also checks these required countries by name (Decision 5): Canada, United States, India, Pakistan, Sri Lanka, Philippines, China, Jamaica, Trinidad and Tobago, Nigeria, Ethiopia, Somalia, South Korea, Vietnam, Lebanon, Iran, Portugal, Greece, Poland, Ukraine.

### Neutral cuisines (3)
| code | name | sort_order | icon (Ionicons, `@expo/vector-icons`) |
|---|---|---|---|
| `street-food` | Street food | 900 | `fast-food-outline` |
| `fusion` | Fusion | 910 | `shuffle-outline` |
| `other` | Other | 999 | `ellipsis-horizontal-circle-outline` |

These icons are different from the tab icons (restaurant, home, person, storefront), so a cuisine is never confused with a tab.

## Storage
None.

## Edge Functions
None.

## Components & hooks
New feature folder `src/features/cuisines/`:
- `schema.ts` — zod schema for a row, as a discriminated union on `kind`:
  - `country`: `code` matches `^[A-Z]{2}$`, `flag` is a string, `icon` is null
  - `neutral`: `code` is a kebab slug, `flag` is null, `icon` is an Ionicons glyph name
  - Exports the `Cuisine`, `CountryCuisine` and `NeutralCuisine` types, plus `FALLBACK_CUISINE_ICON = 'ellipsis-horizontal-circle-outline'`.
  - Icon check: if a neutral row's `icon` isn't a key of `Ionicons.glyphMap`, for example after an icon-package upgrade renames it, the row parses with `FALLBACK_CUISINE_ICON` instead of failing. Any other shape error fails the parse.
- `api.ts`:
  - `listCuisines(): Promise<Cuisine[]>` selects `code, kind, name, flag, icon, sort_order`, orders by `sort_order` then `name`, and parses the rows with the schema.
  - `CuisineAppError` with codes `'network' | 'invalid_data' | 'unknown'`, and `mapCuisineError`, following the `ProfileAppError` pattern.
- `hooks/useCuisines.ts`:
  - `cuisinesKey = ['cuisines'] as const`
  - `useCuisines()` is a `useQuery<Cuisine[], CuisineAppError>` with `staleTime: Infinity`. The list only changes with a migration, so it loads once per app launch.
  - `useCuisine(code: string | null | undefined)` uses the same key with `select` to find one cuisine. It returns `undefined` for an unknown code or a null code, and sends no extra request.

No UI components. Spec 05 adds the shared cuisine display component (Decision 9). Every consumer follows the display rule below.

## Files to create
- `supabase/migrations/<timestamp>_cuisine_catalog.sql`
- `supabase/tests/04-cuisine-catalog.test.sql`
- `src/features/cuisines/schema.ts`, `api.ts`, `hooks/useCuisines.ts`
- `src/features/cuisines/__tests__/schema.test.ts`, `api.test.ts`, `useCuisines.test.tsx`

## Files to change
- `supabase/tests/03-navigation-shell.test.sql` — add `cuisines` to the ALLOWLIST block (`select 'cuisines'::name`).
- `src/types/database.ts` — regenerate with `npm run db:types`. Never edit it by hand.
- `.claude/skills/supabase-patterns/SKILL.md` — make the core-tables line for `cuisines` match this spec: `code` PK (permanent), `kind`, `name`, generated `flag`, `icon`, `sort_order`. Rename `cuisine_id` to `cuisine_code` in the `businesses` and `food_logs` lines and in the api / activity-grid examples. Add a short "Read-only lookup tables" note: revoke all, grant select to anon + authenticated, a `using (true)` select policy, no write policies, an allowlist entry in the 03 test, and a guard trigger for permanent keys.
- `CLAUDE.md` — add `cuisines` to the feature-folder list under Architecture, and set status row 04.
- `docs/product/v1.md` — add a changelog line for spec 04, and a §16 carried-forward line for the spec 03 VoiceOver check on a real iOS device (added during implementation, approved 2026-11-03).

## New dependencies
No new dependencies. `@expo/vector-icons` (Ionicons) is already installed from spec 03.

## Rules for implementation
Always include:
- RLS on every new table + pgTAP test
- Supabase calls only in `src/features/<x>/api.ts`
- Theme tokens only, no hardcoded colors/sizes (no UI in this spec)
- Loading / empty / error / success states on every screen (no screens in this spec; the hook exposes all four to its consumers)
- Accessibility labels on every touchable (no touchables in this spec)

Feature-specific rules:
- **Read-only from the app.** No insert, update or delete grants or policies for `anon` or `authenticated`. The api file has no write functions.
- **Revoke-then-grant:** `revoke all … from anon, authenticated` and then `grant select … to anon, authenticated`, in that order, in the same migration that creates the table.
- **Codes are permanent.** Never rename or reuse a code, and never delete a row. The guard trigger enforces this. A later migration may only insert new rows or update `name`, `icon` or `sort_order`.
- **The seed lives in the migration**, not in `seed.sql`, so production gets the same rows.
- **Display rule for every later consumer (05, 07, 08, 13, 15):**
  - The country name (e.g. "Italy", never "Italian", Decision 7) always shows as visible text next to the flag or icon. Where there's no room for text (map markers, grid squares), the name goes in the element's `accessibilityLabel` instead.
  - The flag emoji or icon itself is hidden from screen readers (`accessible={false}` / `importantForAccessibility="no"`), so VoiceOver reads "Italy", not "flag: Italy, Italy".
  - A country shows its `flag`; a neutral cuisine shows its `icon`. Never show a flag alone with no name.
- **Known platform quirk (accepted, Decision 6):** iOS hides the 🇹🇼 emoji on devices set to a mainland-China region, where it shows as a missing glyph. We accept this. Under the display rule the name "Taiwan" still shows, so the cuisine is still identifiable. No workaround in v1.
- `listCuisines` works without a session (anon key). This is the first data call guests make.
- Types come from the generated `Database` type. Rows are still parsed with zod, because `kind`, `flag` and `icon` are only typed as `string | null`.

## Out of scope
- Searching or filtering the cuisine list (pickers in 05 / 13 decide their own UX)
- Filtering the map by cuisine
- Admin editing of cuisines (migrations only)
- Picker or display components, and any screen (spec 05)
- Retiring or hiding a cuisine (`is_active`)
- Diet tags such as vegan or halal (Decision 3)
- Localised (non-English) names, and cuisine words ("Italian") instead of country names
- Regional sub-cuisines (e.g. Sichuan, Punjabi), UK nations (England, Scotland, Wales), and multiple cuisines per seller or upload
- Image-file flags
- Anything in `docs/product/v1.md` §3

## Definition of done
**Data**
- [ ] `public.cuisines` has exactly 200 rows: 197 countries and 3 neutral rows (`street-food`, `fusion`, `other`). There is no `vegan` row.
- [ ] The set of the 197 country codes equals the approved list exactly: the 193 UN members plus TW, PS, HK and PR, and no other territories.
- [ ] All 20 required countries (Decision 5) are present by name.
- [ ] Known flags are correct: `IT` = 🇮🇹, `CA` = 🇨🇦, `JP` = 🇯🇵, `GB` = 🇬🇧, `TW` = 🇹🇼.
- [ ] Each of the 197 country rows has a non-null flag equal to the regional-indicator pair for its code, and a null icon. Every neutral row has a null flag and a non-null icon.
- [ ] Names match Decision 6: Taiwan, Palestine, Hong Kong, Puerto Rico, Russia, Türkiye, Czechia, United Kingdom.
- [ ] Constraints reject: a lower-case or 3-letter country code, a country with an icon, a neutral row with an upper-case code or no icon, and a duplicate name.
- [ ] `listCuisines()` returns countries alphabetically, with accented names in reading order (Costa Rica, Côte d'Ivoire, Croatia; San Marino, São Tomé and Príncipe, Saudi Arabia; Tunisia, Türkiye, Turkmenistan), then Street food, Fusion, Other.

**Codes are permanent**
- [ ] Updating a row's `code` fails with `cuisine_code_permanent`, even as the table owner (migration role).
- [ ] Deleting any row fails with `cuisine_code_permanent`, even as the table owner.
- [ ] Updating `name`, `icon` or `sort_order` as the table owner still works.

**Security (pgTAP)**
- [ ] RLS is enabled on `cuisines` (also covered by `00_rls_enabled`).
- [ ] `anon` and `authenticated` both hold exactly `SELECT` on `cuisines` and no column privileges beyond that.
- [ ] An outsider (anon) can read all rows but cannot insert, update or delete any cuisine (42501).
- [ ] A signed-in user cannot insert, update or delete any cuisine (42501).
- [ ] `anon` and `authenticated` cannot execute `public.cuisines_guard()`.
- [ ] The 03 allowlist test passes with `cuisines` allowlisted, and still fails for any other table granted to anon.
- [ ] `00_rls_enabled`, `02-auth-and-profiles` and `03-navigation-shell` still pass.

**App**
- [ ] `useCuisines()` exposes loading, error (with `refetch` for retry) and success, and doesn't refetch on remount within a launch (`staleTime: Infinity`).
- [ ] `useCuisine('IT')` returns Italy from the cached list without a second request. `useCuisine('XX')` and `useCuisine(null)` return `undefined`.
- [ ] A neutral row with an unknown icon name parses with the fallback icon. A malformed row (e.g. a country with no flag) makes `listCuisines` throw `CuisineAppError('invalid_data')`.
- [ ] Network and Postgres errors map to `CuisineAppError` codes.

**Quality**
- [ ] `src/types/database.ts` is regenerated and includes `cuisines`.
- [ ] The supabase-patterns skill and the CLAUDE.md feature-folder list are updated.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npx supabase test db` all pass.

## Test plan
**Unit tests (jest)** — RNTL v14 calls (`renderHook`, `act`) are awaited.
- `schema.test.ts`:
  - A valid country row and a valid neutral row parse.
  - Shape errors are rejected: a lower-case country code, a country with an icon, a neutral row with a flag, an unknown `kind`.
  - An unknown Ionicons name falls back to `FALLBACK_CUISINE_ICON`.
  - `Ionicons.glyphMap` has all three seeded icon names, so the seed matches the installed icon package.
- `api.test.ts` — supabase mocked:
  - selects the column list and orders by `sort_order` then `name`
  - returns parsed rows
  - throws `invalid_data` on a malformed row
  - maps a network error and a Postgres error to `CuisineAppError`
  - makes no `insert`, `update` or `delete` call
- `useCuisines.test.tsx` — loading → success, error → `refetch` → success, `staleTime` stops a second fetch on remount, `useCuisine` selects by code and returns `undefined` for unknown or null codes.

**Database tests (pgTAP)** — `supabase/tests/04-cuisine-catalog.test.sql`
- RLS is on. `table_privs_are` is `{SELECT}` for both anon and authenticated, with no column privileges beyond select.
- Row counts: 200 in total, 197 countries, 3 neutral, no `vegan` code.
- Exact code set: `set_eq` of all country codes against the 197 codes in the approved list.
- The 20 required country names are all present.
- Known flags: `IT` 🇮🇹, `CA` 🇨🇦, `JP` 🇯🇵, `GB` 🇬🇧, `TW` 🇹🇼.
- Every flag matches its code: `is_empty` on the country rows where `flag is null` or `flag` differs from the regional-indicator pair the test computes from `code`. A separate count shows that all 197 country rows were checked.
- Decision 6 names are present: Taiwan, Palestine, Hong Kong, Puerto Rico, Russia, Türkiye, Czechia, United Kingdom.
- Shape: no country has an icon; every neutral row has an icon and no flag; `other` has the highest `sort_order`.
- Collation: `name` uses `en-x-icu`.
- Order: `order by sort_order, name` gives Costa Rica → Côte d'Ivoire → Croatia, San Marino → São Tomé and Príncipe → Saudi Arabia, and Tunisia → Türkiye → Turkmenistan. The first row is Afghanistan, and the last three rows are Street food, Fusion, Other.
- Constraint violations (run as the test owner): bad country code, country with icon, neutral without icon, duplicate name → `23514` / `23505`.
- Permanent codes (run as the test owner): update `code` → `cuisine_code_permanent`; delete a row → `cuisine_code_permanent`; update `name` → succeeds (inside the rolled-back transaction).
- As anon: select returns all rows; insert, update and delete throw `42501`; `cuisines_guard()` is not executable.
- As authenticated (a fake user's JWT claims): select works; insert, update and delete throw `42501`.
- `03-navigation-shell.test.sql`: allowlist updated, plan count unchanged.

**Manual check on device**
- No screen to check in this spec. Flag rendering, including the accepted iOS Taiwan quirk, is checked on both platforms in spec 05's picker.
- Locally: `npx supabase db reset`, then in Studio confirm 200 rows in `cuisines` and that the flags render in the table view.

## Decisions (approved 2026-11-02)
1. **Neutral codes:** lower-case kebab slugs in the same `code` column, plus a `kind` column. Codes are permanent, never renamed or reused. The `cuisines_guard` trigger enforces this by blocking code changes and all deletes.
2. **Flag:** a generated column computed from the code. The tests check known pairs (IT, CA, JP, GB, TW) and that every country row has a flag.
3. **Vegan dropped.** The neutral cuisines are Street food, Fusion and Other.
4. **Sort order:** countries alphabetical (100), then Street food (900), Fusion (910), Other (999, always last).
5. **Country list:** all 193 UN member states plus Taiwan, Palestine, Hong Kong and Puerto Rico (197), plus the 3 neutral cuisines, for 200 rows. No other territories. It must include Canada, United States, India, Pakistan, Sri Lanka, Philippines, China, Jamaica, Trinidad and Tobago, Nigeria, Ethiopia, Somalia, South Korea, Vietnam, Lebanon, Iran, Portugal, Greece, Poland and Ukraine; all 20 are in the list above. A test checks that each of the 197 country rows has a flag matching its code. The final list is pending Archan's review.
6. **Names:** Taiwan, Palestine, Hong Kong, Puerto Rico, Russia, Türkiye, Czechia. The name always shows as text with the flag. The iOS Taiwan flag quirk is accepted (see Rules).
7. **Country names** in v1 ("Italy", not "Italian").
8. **United Kingdom only** (GB); no England, Scotland or Wales.
9. **No shared display component** in this spec; spec 05 adds it.
10. **Permanence trigger:** keep `cuisines_guard` (approved).
11. **Neutral icon required (added during implementation, approved 2026-11-03):** `cuisines_neutral_shape` checks `icon is not null` before the regex. A regex match on a null icon returns null, and a check constraint passes on null, so without it a neutral row with no icon would be silently accepted.

## Open questions
None.

Closed:
1. ~~**Country list approval (Decision 5):**~~ Approved with the plan on 2026-11-03, list unchanged. Archan reviewed the 197 countries above, including these naming choices: "Congo" / "DR Congo", "Cabo Verde", "Eswatini", "Timor-Leste", "Micronesia", and the accented "Côte d'Ivoire" and "São Tomé and Príncipe". The accents are why `name` uses the ICU collation.
