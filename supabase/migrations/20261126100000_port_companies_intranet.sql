-- =====================================================================
-- PORT follows the MJM Intranet company master list
--
--   port_companies       copy of the Intranet companies (gw_companies), keyed
--                        by the Intranet company id. Filled by the Edge
--                        Functions at every sign-in and by "Sync from Intranet".
--                        Sorted by the Intranet company code (01, 02, …).
--   port_user_companies  which companies each person may open in each PORT
--                        module, exactly as the Intranet gives them (business +
--                        company access on that module's icon). Replaced at
--                        every sign-in from the Intranet.
--   port_estate_company  old estate name → Intranet company. Every estate name
--                        already stored in the data tables (e.g. the three
--                        Mega Jutamas estates) points to ONE company; the name
--                        itself is kept as the location inside that company.
--   company_id           new column on every data table = the Intranet company
--                        id. Filled from port_estate_company for old rows and,
--                        by a trigger, for every new row the apps still save
--                        with an estate name only.
--
-- Additive only: nothing is dropped or renamed; the `estate` columns stay.
-- Safe to run more than once.
-- =====================================================================

-- ── Companies (mirror of the Intranet) ──────────────────────────────────
create table if not exists public.port_companies (
  id          uuid primary key,          -- gw_companies.id in the MJM Intranet
  code        text,                      -- Intranet company code: 01, 02, …
  name        text not null,
  short_name  text,
  opispro_id  text,
  is_active   boolean not null default true,
  synced_at   timestamptz not null default now()
);
-- The order every company dropdown uses: Intranet company code, then name
create index if not exists port_companies_code_idx on public.port_companies (code, name);

-- ── Access per person, module and company (from the Intranet) ───────────
create table if not exists public.port_user_companies (
  email       text not null check (email = lower(email)),
  module      text not null check (module in ('stock', 'report', 'mantap')),
  company_id  uuid not null references public.port_companies (id) on delete cascade,
  synced_at   timestamptz not null default now(),
  primary key (email, module, company_id)
);
create index if not exists port_user_companies_company_idx on public.port_user_companies (company_id);

-- ── Old estate names → Intranet company ─────────────────────────────────
create table if not exists public.port_estate_company (
  estate      text primary key,          -- the name stored in the data tables' estate column
  company_id  uuid references public.port_companies (id),
  matched_by  text not null default 'auto' check (matched_by in ('auto', 'manual')),
  updated_at  timestamptz not null default now()
);

-- ── company_id on every data table ──────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'port_items', 'port_locations', 'port_transactions', 'port_manuring_rounds',
    'port_fieldmaint_rounds', 'port_maint_claims', 'port_chem_ingredients', 'port_rainfall_txns',
    'port_dashboard_comments', 'port_mgmt_monthly', 'port_estate_blocks'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I add column if not exists company_id uuid references public.port_companies (id)', t);
    execute format('create index if not exists %I on public.%I (company_id)', t || '_company_idx', t);
  end loop;
end $$;

-- New rows the apps save with an estate name only get their company here
create or replace function public.port_fill_company_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null and coalesce(new.estate, '') <> '' then
    select m.company_id into new.company_id from public.port_estate_company m where m.estate = new.estate;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'port_items', 'port_locations', 'port_transactions', 'port_manuring_rounds',
    'port_fieldmaint_rounds', 'port_maint_claims', 'port_chem_ingredients', 'port_rainfall_txns',
    'port_dashboard_comments', 'port_mgmt_monthly', 'port_estate_blocks'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists port_fill_company_id on public.%I', t);
    execute format('create trigger port_fill_company_id before insert or update of estate, company_id on public.%I '
                   'for each row execute function public.port_fill_company_id()', t);
  end loop;
end $$;

-- ── Link old estate names to Intranet companies, then fill company_id ───
-- Automatic match, only when exactly ONE company fits:
--   estate name = company name / short name / code   (e.g. "Gama Menang")
--   estate name = "<company name> (<location>)"     (e.g. "Mega Jutamas (Suai)")
-- Rows set by hand (matched_by = 'manual') are never changed. Anything left
-- unmatched is listed by the port_estates_unlinked view below.
create or replace function public.port_link_estates()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  r record;
  hit uuid;
  hits int;
  linked int := 0;
  filled int := 0;
  c int;
  tables text[] := array[
    'port_items', 'port_locations', 'port_transactions', 'port_manuring_rounds',
    'port_fieldmaint_rounds', 'port_maint_claims', 'port_chem_ingredients', 'port_rainfall_txns',
    'port_dashboard_comments', 'port_mgmt_monthly', 'port_estate_blocks'
  ];
begin
  -- 1. every estate name in use (data tables + the old estate list)
  insert into public.port_estate_company (estate)
  select name from public.port_estates where coalesce(name, '') <> ''
  on conflict (estate) do nothing;
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('insert into public.port_estate_company (estate)
                    select distinct estate from public.%I where coalesce(estate, '''') <> ''''
                    on conflict (estate) do nothing', t);
  end loop;

  -- 2. automatic match for the ones not linked yet
  for r in select estate from public.port_estate_company where company_id is null and matched_by = 'auto' loop
    select count(*), (array_agg(co.id))[1] into hits, hit
      from public.port_companies co
     where lower(trim(r.estate)) in (lower(trim(co.name)), lower(trim(coalesce(co.short_name, ''))), lower(trim(coalesce(co.code, ''))))
        or lower(trim(r.estate)) like lower(trim(co.name)) || ' (%)';
    if hits = 1 then
      update public.port_estate_company set company_id = hit, updated_at = now() where estate = r.estate;
      linked := linked + 1;
    end if;
  end loop;

  -- 3. fill company_id on rows that do not have it yet
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('update public.%I d set company_id = m.company_id
                      from public.port_estate_company m
                     where d.company_id is null and m.company_id is not null and d.estate = m.estate', t);
    get diagnostics c = row_count;
    filled := filled + c;
  end loop;

  return jsonb_build_object(
    'linked', linked,
    'filled', filled,
    'unlinked', coalesce((select jsonb_agg(estate order by estate) from public.port_estate_company where company_id is null), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.port_link_estates() from public, anon, authenticated;

-- Set an old estate name to a company by hand (Super Admin, SQL Editor):
--   update public.port_estate_company
--      set company_id = (select id from public.port_companies where code = '05'), matched_by = 'manual', updated_at = now()
--    where estate = 'Ulu Niah Estate';
--   select public.port_link_estates();

-- Old estate names still without a company, with how many rows use them
create or replace view public.port_estates_unlinked as
select m.estate,
       (select count(*) from public.port_transactions x where x.estate = m.estate) as transactions,
       (select count(*) from public.port_items x where x.estate = m.estate)        as items,
       (select count(*) from public.port_mgmt_monthly x where x.estate = m.estate)  as mgmt_months
  from public.port_estate_company m
 where m.company_id is null;
revoke all on public.port_estates_unlinked from public, anon, authenticated;

-- ── Who may open a company (for the cutover access rules) ───────────────
-- True when the signed-in caller was given this company by the Intranet in
-- any PORT module (the Intranet Super Admin is given every company).
create or replace function public.port_can_access_company(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.port_user_companies uc
     where uc.email = lower(coalesce(auth.jwt() ->> 'email', ''))
       and uc.company_id = p_company)
$$;
revoke all on function public.port_can_access_company(uuid) from public, anon;
grant execute on function public.port_can_access_company(uuid) to authenticated;

-- ── Read access ─────────────────────────────────────────────────────────
-- Companies: anyone signed in may read the list (names / codes only).
-- Access rows: each person reads their own. Writes: Edge Functions only.
alter table public.port_companies      enable row level security;
alter table public.port_user_companies enable row level security;
alter table public.port_estate_company enable row level security;
revoke all on public.port_companies, public.port_user_companies, public.port_estate_company from anon, authenticated;
grant select on public.port_companies, public.port_user_companies to authenticated;

drop policy if exists port_companies_read on public.port_companies;
create policy port_companies_read on public.port_companies for select to authenticated using (true);
drop policy if exists port_user_companies_read on public.port_user_companies;
create policy port_user_companies_read on public.port_user_companies for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));
