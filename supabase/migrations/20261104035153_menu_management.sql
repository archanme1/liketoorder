-- Spec 06: menu management (PR 1, database and storage).
-- One ordered list of menu items per business, one menu currency, and business photos (cover,
-- gallery, menu pages, item photos) in the private `business-media` bucket. Every write goes
-- through a security-definer function that locks the caller's business row, so limits, the
-- currency lock and positions hold under concurrent calls. Files are removed through an outbox:
-- a row's path is queued in the same transaction that deletes the row ("row first, file later").

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

-- Codes are permanent, like cuisine codes: prices are stored against them.
create function public.currencies_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'TRUNCATE' then raise exception 'currency_code_permanent: the table is never truncated'; end if;
  if tg_op = 'DELETE' then raise exception 'currency_code_permanent: rows are never deleted'; end if;
  if new.code <> old.code then raise exception 'currency_code_permanent: codes are never renamed'; end if;
  return new;
end $$;
create trigger currencies_guard before update or delete on public.currencies
  for each row execute function public.currencies_guard();
create trigger currencies_guard_truncate before truncate on public.currencies
  for each statement execute function public.currencies_guard();

-- Trigger functions are never called directly by clients.
revoke execute on function public.currencies_guard() from public, anon, authenticated;

-- Seed (here, not in seed.sql, so production gets the same rows).
-- Excluded: fund codes (BOV, CHE, CHW, CLF, COU, MXV, USN, UYI, UYW), precious metals (XAG, XAU,
-- XPD, XPT), SDR/units (XDR, XSU, XUA, XBA–XBD), test/none (XTS, XXX), and codes replaced and no
-- longer circulating (ANG → XCG, BGN → EUR, HRK → EUR, SLL → SLE, ZWL → ZWG, CUC). VED is left out:
-- it is an accounting code for the same notes as VES.
insert into public.currencies (code, name, minor_units) values
  ('AED', 'UAE dirham', 2),
  ('AFN', 'Afghan afghani', 2),
  ('ALL', 'Albanian lek', 2),
  ('AMD', 'Armenian dram', 2),
  ('AOA', 'Angolan kwanza', 2),
  ('ARS', 'Argentine peso', 2),
  ('AUD', 'Australian dollar', 2),
  ('AWG', 'Aruban florin', 2),
  ('AZN', 'Azerbaijani manat', 2),
  ('BAM', 'Bosnia and Herzegovina convertible mark', 2),
  ('BBD', 'Barbados dollar', 2),
  ('BDT', 'Bangladeshi taka', 2),
  ('BHD', 'Bahraini dinar', 3),
  ('BIF', 'Burundian franc', 0),
  ('BMD', 'Bermudian dollar', 2),
  ('BND', 'Brunei dollar', 2),
  ('BOB', 'Bolivian boliviano', 2),
  ('BRL', 'Brazilian real', 2),
  ('BSD', 'Bahamian dollar', 2),
  ('BTN', 'Bhutanese ngultrum', 2),
  ('BWP', 'Botswana pula', 2),
  ('BYN', 'Belarusian ruble', 2),
  ('BZD', 'Belize dollar', 2),
  ('CAD', 'Canadian dollar', 2),
  ('CDF', 'Congolese franc', 2),
  ('CHF', 'Swiss franc', 2),
  ('CLP', 'Chilean peso', 0),
  ('CNY', 'Chinese yuan', 2),
  ('COP', 'Colombian peso', 2),
  ('CRC', 'Costa Rican colón', 2),
  ('CUP', 'Cuban peso', 2),
  ('CVE', 'Cape Verdean escudo', 2),
  ('CZK', 'Czech koruna', 2),
  ('DJF', 'Djiboutian franc', 0),
  ('DKK', 'Danish krone', 2),
  ('DOP', 'Dominican peso', 2),
  ('DZD', 'Algerian dinar', 2),
  ('EGP', 'Egyptian pound', 2),
  ('ERN', 'Eritrean nakfa', 2),
  ('ETB', 'Ethiopian birr', 2),
  ('EUR', 'Euro', 2),
  ('FJD', 'Fiji dollar', 2),
  ('FKP', 'Falkland Islands pound', 2),
  ('GBP', 'Pound sterling', 2),
  ('GEL', 'Georgian lari', 2),
  ('GHS', 'Ghanaian cedi', 2),
  ('GIP', 'Gibraltar pound', 2),
  ('GMD', 'Gambian dalasi', 2),
  ('GNF', 'Guinean franc', 0),
  ('GTQ', 'Guatemalan quetzal', 2),
  ('GYD', 'Guyanese dollar', 2),
  ('HKD', 'Hong Kong dollar', 2),
  ('HNL', 'Honduran lempira', 2),
  ('HTG', 'Haitian gourde', 2),
  ('HUF', 'Hungarian forint', 2),
  ('IDR', 'Indonesian rupiah', 2),
  ('ILS', 'Israeli new shekel', 2),
  ('INR', 'Indian rupee', 2),
  ('IQD', 'Iraqi dinar', 3),
  ('IRR', 'Iranian rial', 2),
  ('ISK', 'Icelandic króna', 0),
  ('JMD', 'Jamaican dollar', 2),
  ('JOD', 'Jordanian dinar', 3),
  ('JPY', 'Japanese yen', 0),
  ('KES', 'Kenyan shilling', 2),
  ('KGS', 'Kyrgyzstani som', 2),
  ('KHR', 'Cambodian riel', 2),
  ('KMF', 'Comorian franc', 0),
  ('KPW', 'North Korean won', 2),
  ('KRW', 'South Korean won', 0),
  ('KWD', 'Kuwaiti dinar', 3),
  ('KYD', 'Cayman Islands dollar', 2),
  ('KZT', 'Kazakhstani tenge', 2),
  ('LAK', 'Lao kip', 2),
  ('LBP', 'Lebanese pound', 2),
  ('LKR', 'Sri Lankan rupee', 2),
  ('LRD', 'Liberian dollar', 2),
  ('LSL', 'Lesotho loti', 2),
  ('LYD', 'Libyan dinar', 3),
  ('MAD', 'Moroccan dirham', 2),
  ('MDL', 'Moldovan leu', 2),
  ('MGA', 'Malagasy ariary', 2),
  ('MKD', 'Macedonian denar', 2),
  ('MMK', 'Myanmar kyat', 2),
  ('MNT', 'Mongolian tögrög', 2),
  ('MOP', 'Macanese pataca', 2),
  ('MRU', 'Mauritanian ouguiya', 2),
  ('MUR', 'Mauritian rupee', 2),
  ('MVR', 'Maldivian rufiyaa', 2),
  ('MWK', 'Malawian kwacha', 2),
  ('MXN', 'Mexican peso', 2),
  ('MYR', 'Malaysian ringgit', 2),
  ('MZN', 'Mozambican metical', 2),
  ('NAD', 'Namibian dollar', 2),
  ('NGN', 'Nigerian naira', 2),
  ('NIO', 'Nicaraguan córdoba', 2),
  ('NOK', 'Norwegian krone', 2),
  ('NPR', 'Nepalese rupee', 2),
  ('NZD', 'New Zealand dollar', 2),
  ('OMR', 'Omani rial', 3),
  ('PAB', 'Panamanian balboa', 2),
  ('PEN', 'Peruvian sol', 2),
  ('PGK', 'Papua New Guinean kina', 2),
  ('PHP', 'Philippine peso', 2),
  ('PKR', 'Pakistani rupee', 2),
  ('PLN', 'Polish złoty', 2),
  ('PYG', 'Paraguayan guaraní', 0),
  ('QAR', 'Qatari riyal', 2),
  ('RON', 'Romanian leu', 2),
  ('RSD', 'Serbian dinar', 2),
  ('RUB', 'Russian ruble', 2),
  ('RWF', 'Rwandan franc', 0),
  ('SAR', 'Saudi riyal', 2),
  ('SBD', 'Solomon Islands dollar', 2),
  ('SCR', 'Seychelles rupee', 2),
  ('SDG', 'Sudanese pound', 2),
  ('SEK', 'Swedish krona', 2),
  ('SGD', 'Singapore dollar', 2),
  ('SHP', 'Saint Helena pound', 2),
  ('SLE', 'Sierra Leonean leone', 2),
  ('SOS', 'Somali shilling', 2),
  ('SRD', 'Surinamese dollar', 2),
  ('SSP', 'South Sudanese pound', 2),
  ('STN', 'São Tomé and Príncipe dobra', 2),
  ('SVC', 'Salvadoran colón', 2),
  ('SYP', 'Syrian pound', 2),
  ('SZL', 'Eswatini lilangeni', 2),
  ('THB', 'Thai baht', 2),
  ('TJS', 'Tajikistani somoni', 2),
  ('TMT', 'Turkmenistani manat', 2),
  ('TND', 'Tunisian dinar', 3),
  ('TOP', 'Tongan paʻanga', 2),
  ('TRY', 'Turkish lira', 2),
  ('TTD', 'Trinidad and Tobago dollar', 2),
  ('TWD', 'New Taiwan dollar', 2),
  ('TZS', 'Tanzanian shilling', 2),
  ('UAH', 'Ukrainian hryvnia', 2),
  ('UGX', 'Ugandan shilling', 0),
  ('USD', 'US dollar', 2),
  ('UYU', 'Uruguayan peso', 2),
  ('UZS', 'Uzbekistani sum', 2),
  ('VES', 'Venezuelan bolívar', 2),
  ('VND', 'Vietnamese đồng', 0),
  ('VUV', 'Vanuatu vatu', 0),
  ('WST', 'Samoan tālā', 2),
  ('XAF', 'Central African CFA franc', 0),
  ('XCD', 'East Caribbean dollar', 2),
  ('XCG', 'Caribbean guilder', 2),
  ('XOF', 'West African CFA franc', 0),
  ('XPF', 'CFP franc', 0),
  ('YER', 'Yemeni rial', 2),
  ('ZAR', 'South African rand', 2),
  ('ZMW', 'Zambian kwacha', 2),
  ('ZWG', 'Zimbabwe Gold', 2);

-- ── Businesses: one menu currency ──────────────────────────────────────────────
-- Null until chosen. Written only by set_menu_currency().
alter table public.businesses
  add column currency_code text references public.currencies(code) on update restrict on delete restrict;

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
  -- Deferred so a move can swap two positions and a delete can shift the rest in one statement.
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
-- Lets the menu_items cascade find pending item photos too (the unique index above is ready-only).
create index business_photos_menu_item_idx on public.business_photos (menu_item_id)
  where menu_item_id is not null;

-- ── Storage cleanup queue (outbox): files to remove after their row is gone ───
create table public.storage_cleanup_queue (
  path         text primary key,
  business_id  uuid not null,      -- no FK: rows must outlive a deleted business
  queued_at    timestamptz not null default now()
);

-- Every deleted photo row queues its file in the same transaction, including FK cascades from
-- menu_items and businesses.
create function public.business_photos_queue_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.storage_cleanup_queue (path, business_id)
  values (old.path, old.business_id)
  on conflict (path) do nothing;
  return old;
end $$;
create trigger business_photos_queue_cleanup after delete on public.business_photos
  for each row execute function public.business_photos_queue_cleanup();
revoke execute on function public.business_photos_queue_cleanup() from public, anon, authenticated;

-- ── RLS and grants ────────────────────────────────────────────────────────────
alter table public.currencies enable row level security;
alter table public.menu_items enable row level security;
alter table public.business_photos enable row level security;
alter table public.storage_cleanup_queue enable row level security;

revoke all on public.currencies from anon, authenticated;
revoke all on public.menu_items from anon, authenticated;
revoke all on public.business_photos from anon, authenticated;
revoke all on public.storage_cleanup_queue from anon, authenticated;

-- ── Private helpers ───────────────────────────────────────────────────────────
-- Policies on one table can't read businesses.owner_id / is_listed (clients hold no privilege on
-- them), so these definer functions answer the one question each policy needs. They reveal nothing
-- beyond what the public businesses select already shows.
create function private.business_is_public(p_business_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.businesses b
                  where b.id = p_business_id and b.is_listed and b.map_lat is not null);
$$;

create function private.owns_business(p_business_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.businesses b
                  where b.id = p_business_id and b.owner_id = (select auth.uid()));
$$;

-- A fresh (< 1 hour) pending reservation of this exact path, for a business the caller owns.
create function private.photo_upload_allowed(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_photos p
                   join public.businesses b on b.id = p.business_id
                  where p.path = p_path
                    and p.status = 'pending'
                    and p.created_at > now() - interval '1 hour'
                    and b.owner_id = (select auth.uid()));
$$;

create function private.photo_is_public(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_photos p
                   join public.businesses b on b.id = p.business_id
                  where p.path = p_path and p.status = 'ready'
                    and b.is_listed and b.map_lat is not null);
$$;

-- Any row (pending or ready) still points at this path: the file must not be deleted.
create function private.photo_is_live(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_photos p where p.path = p_path);
$$;

revoke execute on function private.business_is_public(uuid) from public;
revoke execute on function private.owns_business(uuid) from public;
revoke execute on function private.photo_upload_allowed(text) from public;
revoke execute on function private.photo_is_public(text) from public;
revoke execute on function private.photo_is_live(text) from public;
grant execute on function private.business_is_public(uuid) to anon, authenticated;
grant execute on function private.owns_business(uuid) to anon, authenticated;
grant execute on function private.photo_upload_allowed(text) to anon, authenticated;
grant execute on function private.photo_is_public(text) to anon, authenticated;
grant execute on function private.photo_is_live(text) to anon, authenticated;

-- ── Grants and policies ───────────────────────────────────────────────────────
-- currencies: read-only catalog.
grant select on public.currencies to anon, authenticated;
create policy currencies_select_all on public.currencies for select to anon, authenticated
  using (true);

-- businesses: the menu currency is public with the listing. Written only by set_menu_currency().
grant select (currency_code) on public.businesses to anon, authenticated;

-- menu_items: readable while the business is public, and always by its owner. No write grants:
-- writes go only through the functions below.
grant select (id, business_id, name, description, price_minor, is_available, position)
  on public.menu_items to anon, authenticated;
create policy menu_items_select_public on public.menu_items for select to anon, authenticated
  using ((select private.business_is_public(business_id)));
create policy menu_items_select_own on public.menu_items for select to authenticated
  using ((select private.owns_business(business_id)));

-- business_photos: ready rows of public businesses, and every row to the owner. status and
-- created_at are not granted.
grant select (id, business_id, kind, menu_item_id, path, position)
  on public.business_photos to anon, authenticated;
create policy business_photos_select_public on public.business_photos for select to anon, authenticated
  using (status = 'ready' and (select private.business_is_public(business_id)));
create policy business_photos_select_own on public.business_photos for select to authenticated
  using ((select private.owns_business(business_id)));

-- storage_cleanup_queue: no grants, no policies; only the functions touch it.

-- ── Owner view: add currency_code ─────────────────────────────────────────────
create or replace function public.business_owner_view(p_owner_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'id', b.id,
           'type', b.type,
           'name', b.name,
           'cuisine_code', b.cuisine_code,
           'accepts_table_requests', b.accepts_table_requests,
           'map_lat', b.map_lat,
           'map_lng', b.map_lng,
           'public_address', b.public_address,
           'is_listed', b.is_listed,
           'currency_code', b.currency_code,
           'created_at', b.created_at,
           'updated_at', b.updated_at,
           'location', (select jsonb_build_object('formatted_address', l.formatted_address,
                                                  'lat', l.lat, 'lng', l.lng)
                          from public.business_locations l
                         where l.business_id = b.id))
    from public.businesses b
   where b.owner_id = p_owner_id;
$$;
-- Re-asserted after the replace: never callable by clients.
revoke execute on function public.business_owner_view(uuid) from public, anon, authenticated, service_role;

-- ── Menu functions ────────────────────────────────────────────────────────────
-- Each one locks the caller's business row first. No function takes a business id; an item id
-- that is missing or someone else's gives the same not_found.

create function public.set_menu_currency(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;
  if p_code is null then raise exception 'invalid_input'; end if;

  -- Changing the currency would silently re-read every stored amount (Decision 12).
  if p_code is distinct from b.currency_code
     and exists (select 1 from public.menu_items where business_id = b.id and price_minor is not null) then
    raise exception 'prices_exist';
  end if;

  update public.businesses set currency_code = p_code where id = b.id;   -- unknown code → 23503
end $$;
revoke execute on function public.set_menu_currency(text) from public, anon, authenticated;
grant execute on function public.set_menu_currency(text) to authenticated;

create function public.create_menu_item(
  p_name text,
  p_description text,
  p_price_minor integer,
  p_is_available boolean default true
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b    public.businesses;
  v_id uuid;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;

  if (select count(*) from public.menu_items where business_id = b.id) >= 100 then
    raise exception 'item_limit';
  end if;
  if p_price_minor is not null and b.currency_code is null then
    raise exception 'currency_required';
  end if;

  insert into public.menu_items (business_id, name, description, price_minor, is_available, position)
  values (b.id, p_name,
          case when btrim(coalesce(p_description, '')) = '' then null else p_description end,
          p_price_minor, coalesce(p_is_available, true),
          coalesce((select max(position) from public.menu_items where business_id = b.id), 0) + 1)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_menu_item(text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.create_menu_item(text, text, integer, boolean) to authenticated;

create function public.update_menu_item(
  p_item_id uuid,
  p_name text,
  p_description text,
  p_price_minor integer,
  p_is_available boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;

  if not exists (select 1 from public.menu_items where id = p_item_id and business_id = b.id) then
    raise exception 'not_found';
  end if;
  if p_price_minor is not null and b.currency_code is null then
    raise exception 'currency_required';
  end if;

  update public.menu_items
     set name = p_name,
         description = case when btrim(coalesce(p_description, '')) = '' then null else p_description end,
         price_minor = p_price_minor,
         is_available = coalesce(p_is_available, true)
   where id = p_item_id and business_id = b.id;
end $$;
revoke execute on function public.update_menu_item(uuid, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.update_menu_item(uuid, text, text, integer, boolean) to authenticated;

create function public.move_menu_item(p_item_id uuid, p_direction text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b          public.businesses;
  v_pos      integer;
  v_other_id uuid;
  v_other    integer;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;
  if p_direction is null or p_direction not in ('up', 'down') then
    raise exception 'invalid_direction';
  end if;

  select position into v_pos from public.menu_items where id = p_item_id and business_id = b.id;
  if not found then raise exception 'not_found'; end if;

  v_other := case p_direction when 'up' then v_pos - 1 else v_pos + 1 end;
  select id into v_other_id from public.menu_items where business_id = b.id and position = v_other;
  if not found then return; end if;   -- already at that end

  update public.menu_items
     set position = case when id = p_item_id then v_other else v_pos end
   where id in (p_item_id, v_other_id);
end $$;
revoke execute on function public.move_menu_item(uuid, text) from public, anon, authenticated;
grant execute on function public.move_menu_item(uuid, text) to authenticated;

-- The item's photo row cascades, and its trigger queues the file.
create function public.delete_menu_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b     public.businesses;
  v_pos integer;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;

  delete from public.menu_items where id = p_item_id and business_id = b.id
  returning position into v_pos;
  if not found then raise exception 'not_found'; end if;

  update public.menu_items set position = position - 1
   where business_id = b.id and position > v_pos;
end $$;
revoke execute on function public.delete_menu_item(uuid) from public, anon, authenticated;
grant execute on function public.delete_menu_item(uuid) to authenticated;

-- ── Photo functions: reserve → upload (Storage API) → finish ──────────────────

-- Reserves a server-made path. The storage insert policy accepts an upload only at a path reserved
-- here less than an hour ago, so every stored object is capped by these row limits.
create function public.begin_photo_upload(p_kind text, p_menu_item_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      public.businesses;
  v_id   uuid := gen_random_uuid();
  v_path text;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;

  if p_kind is null or p_kind not in ('cover', 'gallery', 'menu', 'item') then
    raise exception 'invalid_input';
  end if;
  if (p_kind = 'item') <> (p_menu_item_id is not null) then
    raise exception 'invalid_input';
  end if;
  if p_kind = 'item'
     and not exists (select 1 from public.menu_items where id = p_menu_item_id and business_id = b.id) then
    raise exception 'invalid_input';
  end if;

  -- Expired reservations stop counting; the trigger queues their paths for cleanup.
  delete from public.business_photos
   where business_id = b.id and status = 'pending' and created_at <= now() - interval '1 hour';

  if (p_kind = 'gallery'
        and (select count(*) from public.business_photos
              where business_id = b.id and kind = 'gallery') >= 6)
     or (p_kind = 'menu'
        and (select count(*) from public.business_photos
              where business_id = b.id and kind = 'menu') >= 10)
     -- Cover and item: the ready one is replaced on finish, so only one pending at a time.
     or (p_kind = 'cover'
        and exists (select 1 from public.business_photos
                     where business_id = b.id and kind = 'cover' and status = 'pending'))
     or (p_kind = 'item'
        and exists (select 1 from public.business_photos
                     where menu_item_id = p_menu_item_id and status = 'pending')) then
    raise exception 'photo_limit';
  end if;

  v_path := b.id::text || '/' || v_id::text || '.jpg';
  insert into public.business_photos (id, business_id, kind, menu_item_id, path)
  values (v_id, b.id, p_kind, p_menu_item_id, v_path);

  return jsonb_build_object('photo_id', v_id, 'path', v_path);
end $$;
revoke execute on function public.begin_photo_upload(text, uuid) from public, anon, authenticated;
grant execute on function public.begin_photo_upload(text, uuid) to authenticated;

-- Marks a reservation ready only once its object exists with an allowed type and size, so a row
-- never points at a missing file. A replaced cover/item photo is deleted here (and queued).
create function public.finish_photo_upload(p_photo_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b     public.businesses;
  p     public.business_photos;
  v_pos integer;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;

  select * into p from public.business_photos
   where id = p_photo_id and business_id = b.id and status = 'pending';
  if not found then raise exception 'not_found'; end if;

  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'business-media'
       and o.name = p.path
       and o.metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
       and case when o.metadata->>'size' ~ '^[0-9]{1,12}$'
                then (o.metadata->>'size')::bigint between 1 and 2097152
                else false end
  ) then
    raise exception 'upload_missing';
  end if;

  if p.kind = 'cover' then
    delete from public.business_photos
     where business_id = b.id and kind = 'cover' and status = 'ready';
  elsif p.kind = 'item' then
    delete from public.business_photos
     where menu_item_id = p.menu_item_id and kind = 'item' and status = 'ready';
  else
    v_pos := coalesce((select max(position) from public.business_photos
                        where business_id = b.id and kind = p.kind and status = 'ready'), 0) + 1;
  end if;

  update public.business_photos set status = 'ready', position = v_pos
   where id = p.id
  returning * into p;

  return jsonb_build_object('id', p.id, 'business_id', p.business_id, 'kind', p.kind,
                            'menu_item_id', p.menu_item_id, 'path', p.path, 'position', p.position);
end $$;
revoke execute on function public.finish_photo_upload(uuid) from public, anon, authenticated;
grant execute on function public.finish_photo_upload(uuid) to authenticated;

-- Deletes a pending or ready photo row; the trigger queues the file. Gallery/menu stay 1..n.
create function public.delete_business_photo(p_photo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
  p public.business_photos;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;

  delete from public.business_photos where id = p_photo_id and business_id = b.id
  returning * into p;
  if not found then raise exception 'not_found'; end if;

  if p.status = 'ready' and p.kind in ('gallery', 'menu') then
    update public.business_photos set position = position - 1
     where business_id = b.id and kind = p.kind and status = 'ready' and position > p.position;
  end if;
end $$;
revoke execute on function public.delete_business_photo(uuid) from public, anon, authenticated;
grant execute on function public.delete_business_photo(uuid) to authenticated;

-- The app removes the returned paths through the Storage API, then calls again: the server checks
-- storage.objects itself and drops the rows whose object is gone, so a file is never marked removed
-- on the client's word.
create function public.claim_photo_cleanup() returns setof text
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;

  delete from public.storage_cleanup_queue q
   where q.business_id = b.id
     and not exists (select 1 from storage.objects o
                      where o.bucket_id = 'business-media' and o.name = q.path);

  return query
    select q.path from public.storage_cleanup_queue q
     where q.business_id = b.id
     order by q.queued_at, q.path;
end $$;
revoke execute on function public.claim_photo_cleanup() from public, anon, authenticated;
grant execute on function public.claim_photo_cleanup() to authenticated;

-- ── Storage: private business-media bucket ────────────────────────────────────
-- Private, so photos disappear with the listing (Decision 10); read through signed URLs.
-- The app always uploads JPEG; PNG/WebP are accepted by the bucket as decided.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-media', 'business-media', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp']);

-- Only at a path reserved by a fresh pending row of a business the caller owns.
create policy business_media_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'business-media'
              and (select private.photo_upload_allowed(name)));

-- Ready photos of public businesses, and everything in the caller's own business folder.
-- The case keeps the ::uuid cast away from folder names that aren't UUIDs (fails closed: false).
create policy business_media_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'business-media'
         and case when (storage.foldername(name))[1]
                       ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then (select private.photo_is_public(name))
                       or (select private.owns_business(((storage.foldername(name))[1])::uuid))
                  else false end);

-- Owners delete only files whose row is gone (queued by the outbox), never live ones.
create policy business_media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'business-media'
         and case when (storage.foldername(name))[1]
                       ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then (select private.owns_business(((storage.foldername(name))[1])::uuid))
                       and not (select private.photo_is_live(name))
                  else false end);

-- No update policy: files are never overwritten (no upsert). Replace = new path + delete the old one.
