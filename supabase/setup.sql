-- =====================================================================
-- Plantation Operation: whole database from scratch
--   Paste into the SQL Editor of a NEW Supabase project and Run once.
--   Creates every table used by Stock, Management Report and the Mantap
--   Worker Portal (they share this project), the helper functions and the
--   access rules the classic app needs. Safe to run again: nothing is
--   dropped, existing rows are kept.
--
--   After this: Authentication → Users → Add user for the Super Admin
--   (hqadmin.puigroups@gmail.com, or the SUPER_ADMIN_EMAIL secret of the
--   Edge Functions), then sign in and add estates / users in the app.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Column names are camelCase (quoted) because the classic app saves its
-- in-memory objects as they are. Ids are Date.now() numbers from the app.
-- Every data table carries `estate` = the estate name (port_estates.name).
-- ---------------------------------------------------------------------

create table if not exists public.port_estates (
  name          text primary key,
  intranet_id   uuid,            -- gw_company_estates.id or gw_companies.id in the MJM Intranet
  intranet_kind text,            -- 'estate' | 'company'
  company_name  text,
  short_name    text,
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  synced_at     timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists port_estates_intranet_id_idx on public.port_estates (intranet_id) where intranet_id is not null;

create table if not exists public.port_users (
  id            bigint primary key,
  name          text not null default '',
  email         text not null,
  password_hash text not null default '',   -- hex SHA-256, checked only inside stock-auth
  estates       jsonb not null default '[]'::jsonb,
  permissions   jsonb not null default '{}'::jsonb,
  status        text not null default 'active',
  last_active   timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists port_users_email_idx on public.port_users (lower(email));

create table if not exists public.port_items (
  id               bigint primary key,
  estate           text not null,
  "itemCode"       text,
  name             text not null,
  category         text not null default '',
  unit             text not null default '',
  "baseUnit"       text,
  "packageUnit"    text,
  "qtyPerUnit"     numeric,
  threshold        numeric,
  "defaultQtyUnit" text,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index if not exists port_items_estate_idx on public.port_items (estate);

create table if not exists public.port_locations (
  id          bigint primary key,
  estate      text not null,
  name        text not null,
  area        numeric,
  "numPalms"  integer,
  created_at  timestamptz not null default now()
);
create index if not exists port_locations_estate_idx on public.port_locations (estate);

create table if not exists public.port_transactions (
  id                  bigint primary key,
  estate              text not null,
  date                text not null,            -- yyyy-mm-dd
  "itemId"            text,
  "itemName"          text not null default '',
  category            text not null default '',
  unit                text not null default '',
  type                text not null default '', -- In | Out | Adj
  qty                 numeric not null default 0,
  "inputQty"          numeric,
  "inputUnit"         text,
  location            text,
  remarks             text,
  "manuringRoundId"   text,
  "manuringRoundName" text,
  "maintRoundId"      text,
  "maintRoundName"    text,
  picture             text,                     -- data URL (compressed JPEG)
  "user"              text,
  created_at          timestamptz not null default now()
);
create index if not exists port_transactions_estate_date_idx on public.port_transactions (estate, date);

create table if not exists public.port_manuring_rounds (
  id                 bigint primary key,
  estate             text not null,
  name               text not null,
  "fertilizerItemId" text,
  "fertilizerName"   text,
  unit               text,
  "kgPerUnit"        numeric,
  "kgPerPalm"        numeric,
  blocks             jsonb not null default '[]'::jsonb,
  notes              text,
  "targetPeriod"     text,                      -- yyyy-mm
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

create table if not exists public.port_fieldmaint_rounds (
  id             bigint primary key,
  estate         text not null,
  name           text not null,
  blocks         jsonb not null default '[]'::jsonb,
  notes          text,
  "targetPeriod" text,
  "maintType"    text,
  "createdAt"    text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists public.port_maint_claims (
  id            bigint primary key,
  estate        text not null,
  "roundId"     text,
  "roundName"   text,
  "blockName"   text,
  "claimedArea" numeric not null default 0,
  month         text,                           -- yyyy-mm
  created_at    timestamptz not null default now()
);

create table if not exists public.port_chem_ingredients (
  id          bigint primary key,
  estate      text not null,
  name        text not null,
  "itemId"    text,
  "itemName"  text,
  unit        text,
  "maxDosage" numeric,
  density     numeric,
  created_at  timestamptz not null default now()
);

create table if not exists public.port_rainfall_txns (
  id          bigint primary key,
  estate      text not null,
  date        text not null,                    -- yyyy-mm-dd
  mm          numeric not null default 0,
  picture     text,
  "createdAt" text,
  created_at  timestamptz not null default now()
);
create index if not exists port_rainfall_estate_date_idx on public.port_rainfall_txns (estate, date);

create table if not exists public.port_dashboard_comments (
  id          bigserial primary key,
  estate      text not null default '',
  author_name text not null default '',
  author_role text not null default '',
  comment     text not null,
  created_at  timestamptz not null default now()
);

-- Management Report: monthly figures per estate (FFB, grading, harvesters, ...)
create table if not exists public.port_mgmt_monthly (
  id            uuid primary key default gen_random_uuid(),
  estate        text not null,
  year          int  not null check (year between 2000 and 2100),
  month         int  not null check (month between 1 and 12),
  ffb_mt        numeric(12,3) check (ffb_mt is null or ffb_mt >= 0),
  grading_pct   numeric(6,2)  check (grading_pct is null or (grading_pct between 0 and 100)),
  harvesters    int           check (harvesters is null or harvesters >= 0),
  harvest_days  int           check (harvest_days is null or harvest_days >= 0),
  downgraded_bunches int      check (downgraded_bunches is null or downgraded_bunches >= 0),
  penalty_rm    numeric(12,2) check (penalty_rm is null or penalty_rm >= 0),
  carlos_open   int, carlos_closed int, carlos_pending int,
  notes         text check (notes is null or char_length(notes) <= 500),
  source        text not null default 'manual',
  updated_by    text,
  updated_at    timestamptz not null default now(),
  unique (estate, year, month)
);
create index if not exists port_mgmt_monthly_estate_year_idx on public.port_mgmt_monthly (estate, year);

-- Sign-in protection (Edge Functions only)
create table if not exists public.stock_login_attempts (
  email        text primary key,
  fails        integer not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);
create table if not exists public.mantap_login_attempts (
  email        text primary key,
  fails        integer not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);
-- Mantap Worker Portal: which Intranet users may use the portal
create table if not exists public.mantap_portal_users (
  email            text primary key check (email = lower(email)),
  name             text not null default '',
  intranet_user_id uuid,
  web_access       boolean not null default false,
  mobile_access    boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Access rules. The classic app signs in with the anon key, so the port_*
-- tables are open to anon and authenticated (same as the old project);
-- the login tables and Mantap portal list are Edge-Function only.
-- The cutover RLS migration tightens this once the classic app retires.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'port_estates','port_users','port_items','port_locations','port_transactions','port_manuring_rounds',
    'port_fieldmaint_rounds','port_maint_claims','port_chem_ingredients','port_rainfall_txns',
    'port_dashboard_comments','port_mgmt_monthly'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)', t || '_all', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to anon, authenticated;

alter table public.stock_login_attempts  enable row level security;
alter table public.mantap_login_attempts enable row level security;
alter table public.mantap_portal_users   enable row level security;
revoke all on public.stock_login_attempts, public.mantap_login_attempts, public.mantap_portal_users from anon, authenticated;

-- The app watches its own port_users row for status changes (sign out when deactivated)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'port_users') then
    alter publication supabase_realtime add table public.port_users;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Rename an estate everywhere its name is stored (used by stock-master-sync
-- when the MJM Intranet calls a company differently).
-- ---------------------------------------------------------------------
create or replace function public.stock_rename_estate(p_old text, p_new text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
  c int;
  t text;
begin
  if p_old is null or p_new is null or p_old = p_new then return 0; end if;
  if exists (select 1 from public.port_estates where name = p_new) then
    raise exception 'estate % already exists', p_new;
  end if;
  for r in
    select table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'estate' and table_name like 'port\_%' escape '\'
  loop
    execute format('update public.%I set estate = $1 where estate = $2', r.table_name) using p_new, p_old;
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  select data_type into t from information_schema.columns
   where table_schema = 'public' and table_name = 'port_users' and column_name = 'estates';
  if t = 'ARRAY' then
    execute 'update public.port_users set estates = array_replace(estates, $2, $1) where $2 = any(estates)' using p_new, p_old;
  elsif t = 'jsonb' then
    execute $q$update public.port_users
                set estates = (select coalesce(jsonb_agg(case when e = $2 then to_jsonb($1) else to_jsonb(e) end), '[]'::jsonb)
                                 from jsonb_array_elements_text(estates) e)
              where estates ? $2$q$ using p_new, p_old;
  end if;
  update public.port_estates set name = p_new where name = p_old;
  return n;
end;
$$;
revoke all on function public.stock_rename_estate(text, text) from public, anon, authenticated;
