-- Spec 04: cuisine catalog.
-- One read-only list of 200 cuisines: 197 countries (193 UN members + TW, PS, HK, PR) with a
-- generated emoji flag, plus 3 neutral cuisines with an Ionicons icon. Only migrations change it;
-- codes are permanent (never renamed, never reused, rows never deleted).

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

-- Explicit grants: guests and signed-in users read; nobody writes from the app.
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

-- Trigger functions are never called directly by clients.
revoke execute on function public.cuisines_guard() from public, anon, authenticated;

-- Seed (lives here, not in seed.sql, so production gets the same rows).
-- Every country has sort_order 100 and sorts by name; neutral cuisines come after, Other last.
insert into public.cuisines (code, kind, name, icon, sort_order) values
  -- Africa — Northern Africa
  ('DZ', 'country', 'Algeria', null, 100),
  ('EG', 'country', 'Egypt', null, 100),
  ('LY', 'country', 'Libya', null, 100),
  ('MA', 'country', 'Morocco', null, 100),
  ('SD', 'country', 'Sudan', null, 100),
  ('TN', 'country', 'Tunisia', null, 100),
  -- Africa — Western Africa
  ('BJ', 'country', 'Benin', null, 100),
  ('BF', 'country', 'Burkina Faso', null, 100),
  ('CV', 'country', 'Cabo Verde', null, 100),
  ('CI', 'country', 'Côte d''Ivoire', null, 100),
  ('GM', 'country', 'Gambia', null, 100),
  ('GH', 'country', 'Ghana', null, 100),
  ('GN', 'country', 'Guinea', null, 100),
  ('GW', 'country', 'Guinea-Bissau', null, 100),
  ('LR', 'country', 'Liberia', null, 100),
  ('ML', 'country', 'Mali', null, 100),
  ('MR', 'country', 'Mauritania', null, 100),
  ('NE', 'country', 'Niger', null, 100),
  ('NG', 'country', 'Nigeria', null, 100),
  ('SN', 'country', 'Senegal', null, 100),
  ('SL', 'country', 'Sierra Leone', null, 100),
  ('TG', 'country', 'Togo', null, 100),
  -- Africa — Middle Africa
  ('AO', 'country', 'Angola', null, 100),
  ('CM', 'country', 'Cameroon', null, 100),
  ('CF', 'country', 'Central African Republic', null, 100),
  ('TD', 'country', 'Chad', null, 100),
  ('CG', 'country', 'Congo', null, 100),
  ('CD', 'country', 'DR Congo', null, 100),
  ('GQ', 'country', 'Equatorial Guinea', null, 100),
  ('GA', 'country', 'Gabon', null, 100),
  ('ST', 'country', 'São Tomé and Príncipe', null, 100),
  -- Africa — Eastern Africa
  ('BI', 'country', 'Burundi', null, 100),
  ('KM', 'country', 'Comoros', null, 100),
  ('DJ', 'country', 'Djibouti', null, 100),
  ('ER', 'country', 'Eritrea', null, 100),
  ('ET', 'country', 'Ethiopia', null, 100),
  ('KE', 'country', 'Kenya', null, 100),
  ('MG', 'country', 'Madagascar', null, 100),
  ('MW', 'country', 'Malawi', null, 100),
  ('MU', 'country', 'Mauritius', null, 100),
  ('MZ', 'country', 'Mozambique', null, 100),
  ('RW', 'country', 'Rwanda', null, 100),
  ('SC', 'country', 'Seychelles', null, 100),
  ('SO', 'country', 'Somalia', null, 100),
  ('SS', 'country', 'South Sudan', null, 100),
  ('TZ', 'country', 'Tanzania', null, 100),
  ('UG', 'country', 'Uganda', null, 100),
  ('ZM', 'country', 'Zambia', null, 100),
  ('ZW', 'country', 'Zimbabwe', null, 100),
  -- Africa — Southern Africa
  ('BW', 'country', 'Botswana', null, 100),
  ('SZ', 'country', 'Eswatini', null, 100),
  ('LS', 'country', 'Lesotho', null, 100),
  ('NA', 'country', 'Namibia', null, 100),
  ('ZA', 'country', 'South Africa', null, 100),
  -- Americas — Northern America
  ('CA', 'country', 'Canada', null, 100),
  ('US', 'country', 'United States', null, 100),
  -- Americas — Caribbean
  ('AG', 'country', 'Antigua and Barbuda', null, 100),
  ('BS', 'country', 'Bahamas', null, 100),
  ('BB', 'country', 'Barbados', null, 100),
  ('CU', 'country', 'Cuba', null, 100),
  ('DM', 'country', 'Dominica', null, 100),
  ('DO', 'country', 'Dominican Republic', null, 100),
  ('GD', 'country', 'Grenada', null, 100),
  ('HT', 'country', 'Haiti', null, 100),
  ('JM', 'country', 'Jamaica', null, 100),
  ('PR', 'country', 'Puerto Rico', null, 100),
  ('KN', 'country', 'Saint Kitts and Nevis', null, 100),
  ('LC', 'country', 'Saint Lucia', null, 100),
  ('VC', 'country', 'Saint Vincent and the Grenadines', null, 100),
  ('TT', 'country', 'Trinidad and Tobago', null, 100),
  -- Americas — Central America
  ('BZ', 'country', 'Belize', null, 100),
  ('CR', 'country', 'Costa Rica', null, 100),
  ('SV', 'country', 'El Salvador', null, 100),
  ('GT', 'country', 'Guatemala', null, 100),
  ('HN', 'country', 'Honduras', null, 100),
  ('MX', 'country', 'Mexico', null, 100),
  ('NI', 'country', 'Nicaragua', null, 100),
  ('PA', 'country', 'Panama', null, 100),
  -- Americas — South America
  ('AR', 'country', 'Argentina', null, 100),
  ('BO', 'country', 'Bolivia', null, 100),
  ('BR', 'country', 'Brazil', null, 100),
  ('CL', 'country', 'Chile', null, 100),
  ('CO', 'country', 'Colombia', null, 100),
  ('EC', 'country', 'Ecuador', null, 100),
  ('GY', 'country', 'Guyana', null, 100),
  ('PY', 'country', 'Paraguay', null, 100),
  ('PE', 'country', 'Peru', null, 100),
  ('SR', 'country', 'Suriname', null, 100),
  ('UY', 'country', 'Uruguay', null, 100),
  ('VE', 'country', 'Venezuela', null, 100),
  -- Asia — Central Asia
  ('KZ', 'country', 'Kazakhstan', null, 100),
  ('KG', 'country', 'Kyrgyzstan', null, 100),
  ('TJ', 'country', 'Tajikistan', null, 100),
  ('TM', 'country', 'Turkmenistan', null, 100),
  ('UZ', 'country', 'Uzbekistan', null, 100),
  -- Asia — Eastern Asia
  ('CN', 'country', 'China', null, 100),
  ('HK', 'country', 'Hong Kong', null, 100),
  ('JP', 'country', 'Japan', null, 100),
  ('MN', 'country', 'Mongolia', null, 100),
  ('KP', 'country', 'North Korea', null, 100),
  ('KR', 'country', 'South Korea', null, 100),
  ('TW', 'country', 'Taiwan', null, 100),
  -- Asia — South-eastern Asia
  ('BN', 'country', 'Brunei', null, 100),
  ('KH', 'country', 'Cambodia', null, 100),
  ('ID', 'country', 'Indonesia', null, 100),
  ('LA', 'country', 'Laos', null, 100),
  ('MY', 'country', 'Malaysia', null, 100),
  ('MM', 'country', 'Myanmar', null, 100),
  ('PH', 'country', 'Philippines', null, 100),
  ('SG', 'country', 'Singapore', null, 100),
  ('TH', 'country', 'Thailand', null, 100),
  ('TL', 'country', 'Timor-Leste', null, 100),
  ('VN', 'country', 'Vietnam', null, 100),
  -- Asia — Southern Asia
  ('AF', 'country', 'Afghanistan', null, 100),
  ('BD', 'country', 'Bangladesh', null, 100),
  ('BT', 'country', 'Bhutan', null, 100),
  ('IN', 'country', 'India', null, 100),
  ('IR', 'country', 'Iran', null, 100),
  ('MV', 'country', 'Maldives', null, 100),
  ('NP', 'country', 'Nepal', null, 100),
  ('PK', 'country', 'Pakistan', null, 100),
  ('LK', 'country', 'Sri Lanka', null, 100),
  -- Asia — Western Asia
  ('AM', 'country', 'Armenia', null, 100),
  ('AZ', 'country', 'Azerbaijan', null, 100),
  ('BH', 'country', 'Bahrain', null, 100),
  ('CY', 'country', 'Cyprus', null, 100),
  ('GE', 'country', 'Georgia', null, 100),
  ('IQ', 'country', 'Iraq', null, 100),
  ('IL', 'country', 'Israel', null, 100),
  ('JO', 'country', 'Jordan', null, 100),
  ('KW', 'country', 'Kuwait', null, 100),
  ('LB', 'country', 'Lebanon', null, 100),
  ('OM', 'country', 'Oman', null, 100),
  ('PS', 'country', 'Palestine', null, 100),
  ('QA', 'country', 'Qatar', null, 100),
  ('SA', 'country', 'Saudi Arabia', null, 100),
  ('SY', 'country', 'Syria', null, 100),
  ('TR', 'country', 'Türkiye', null, 100),
  ('AE', 'country', 'United Arab Emirates', null, 100),
  ('YE', 'country', 'Yemen', null, 100),
  -- Europe — Eastern Europe
  ('BY', 'country', 'Belarus', null, 100),
  ('BG', 'country', 'Bulgaria', null, 100),
  ('CZ', 'country', 'Czechia', null, 100),
  ('HU', 'country', 'Hungary', null, 100),
  ('MD', 'country', 'Moldova', null, 100),
  ('PL', 'country', 'Poland', null, 100),
  ('RO', 'country', 'Romania', null, 100),
  ('RU', 'country', 'Russia', null, 100),
  ('SK', 'country', 'Slovakia', null, 100),
  ('UA', 'country', 'Ukraine', null, 100),
  -- Europe — Northern Europe
  ('DK', 'country', 'Denmark', null, 100),
  ('EE', 'country', 'Estonia', null, 100),
  ('FI', 'country', 'Finland', null, 100),
  ('IS', 'country', 'Iceland', null, 100),
  ('IE', 'country', 'Ireland', null, 100),
  ('LV', 'country', 'Latvia', null, 100),
  ('LT', 'country', 'Lithuania', null, 100),
  ('NO', 'country', 'Norway', null, 100),
  ('SE', 'country', 'Sweden', null, 100),
  ('GB', 'country', 'United Kingdom', null, 100),
  -- Europe — Southern Europe
  ('AL', 'country', 'Albania', null, 100),
  ('AD', 'country', 'Andorra', null, 100),
  ('BA', 'country', 'Bosnia and Herzegovina', null, 100),
  ('HR', 'country', 'Croatia', null, 100),
  ('GR', 'country', 'Greece', null, 100),
  ('IT', 'country', 'Italy', null, 100),
  ('MT', 'country', 'Malta', null, 100),
  ('ME', 'country', 'Montenegro', null, 100),
  ('MK', 'country', 'North Macedonia', null, 100),
  ('PT', 'country', 'Portugal', null, 100),
  ('SM', 'country', 'San Marino', null, 100),
  ('RS', 'country', 'Serbia', null, 100),
  ('SI', 'country', 'Slovenia', null, 100),
  ('ES', 'country', 'Spain', null, 100),
  -- Europe — Western Europe
  ('AT', 'country', 'Austria', null, 100),
  ('BE', 'country', 'Belgium', null, 100),
  ('FR', 'country', 'France', null, 100),
  ('DE', 'country', 'Germany', null, 100),
  ('LI', 'country', 'Liechtenstein', null, 100),
  ('LU', 'country', 'Luxembourg', null, 100),
  ('MC', 'country', 'Monaco', null, 100),
  ('NL', 'country', 'Netherlands', null, 100),
  ('CH', 'country', 'Switzerland', null, 100),
  -- Oceania
  ('AU', 'country', 'Australia', null, 100),
  ('FJ', 'country', 'Fiji', null, 100),
  ('KI', 'country', 'Kiribati', null, 100),
  ('MH', 'country', 'Marshall Islands', null, 100),
  ('FM', 'country', 'Micronesia', null, 100),
  ('NR', 'country', 'Nauru', null, 100),
  ('NZ', 'country', 'New Zealand', null, 100),
  ('PW', 'country', 'Palau', null, 100),
  ('PG', 'country', 'Papua New Guinea', null, 100),
  ('WS', 'country', 'Samoa', null, 100),
  ('SB', 'country', 'Solomon Islands', null, 100),
  ('TO', 'country', 'Tonga', null, 100),
  ('TV', 'country', 'Tuvalu', null, 100),
  ('VU', 'country', 'Vanuatu', null, 100),
  -- Neutral cuisines (no flag; Ionicons icon)
  ('street-food', 'neutral', 'Street food', 'fast-food-outline',                  900),
  ('fusion',      'neutral', 'Fusion',      'shuffle-outline',                    910),
  ('other',       'neutral', 'Other',       'ellipsis-horizontal-circle-outline', 999);
