-- =====================================================================
-- Old estate names → MJM Intranet Locations
--
--   The data tables store a place by name in their `estate` column (old names
--   such as "Mega Jutamas (Sg Rait)"). MJM Intranet now has the official
--   Locations of each company (e.g. "Sg Rait", with its Opispro Location ID).
--
--   port_estate_company gets, for each old name, the Intranet Location it is:
--     location_name / location_id   filled automatically at every Intranet
--                                   sign-in (Edge Functions), or by hand
--     location_matched_by           'auto' | 'manual' (manual is never changed)
--   A company without multiple locations is its own one location.
--
--   Review:  select * from public.port_estate_location_review;
--   Set one by hand:
--     update public.port_estate_company set location_name = 'Sg Rait', location_matched_by = 'manual'
--      where estate = 'Mega Jutamas (Sg Rait)';
--   Then rename the data to the Intranet names (one old name → one Location):
--     select public.port_apply_location_names();
--
-- Safe to run more than once. Nothing is renamed until port_apply_location_names() is run.
-- =====================================================================

alter table public.port_estate_company add column if not exists location_name text;
alter table public.port_estate_company add column if not exists location_id text;
alter table public.port_estate_company add column if not exists location_matched_by text not null default 'auto';
alter table public.port_estate_company drop constraint if exists port_estate_company_location_matched_by_check;
alter table public.port_estate_company add constraint port_estate_company_location_matched_by_check check (location_matched_by in ('auto', 'manual'));

-- What each old name points to, and how much data uses it
create or replace view public.port_estate_location_review as
select m.estate                                  as old_name,
       c.name                                    as company,
       m.location_name,
       m.location_id,
       m.location_matched_by                     as matched_by,
       case
         when m.company_id is null then 'no company yet'
         when m.location_name is null then 'no location yet: set it by hand'
         when m.location_name = m.estate then 'ok (same name)'
         when (select count(*) from public.port_estate_company x
                where x.company_id = m.company_id and x.location_name = m.location_name) > 1 then 'several old names → one location: merge by hand'
         else 'ready to rename'
       end                                       as status,
       (select count(*) from public.port_transactions x where x.estate = m.estate)  as transactions,
       (select count(*) from public.port_rainfall_txns x where x.estate = m.estate) as rainfall
  from public.port_estate_company m
  left join public.port_companies c on c.id = m.company_id
 order by c.name nulls last, m.estate;
revoke all on public.port_estate_location_review from public, anon, authenticated;

-- Rename the data from each old name to its Intranet Location name.
-- Only one old name → one location, and only when no data already uses that
-- name; anything else is skipped and listed. Each name is all-or-nothing.
create or replace function public.port_apply_location_names()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  r record;
  t text;
  used boolean;
  renamed jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
begin
  for m in
    select e.* from public.port_estate_company e
     where e.company_id is not null and e.location_name is not null and e.location_name <> e.estate
  loop
    -- several old names → one location: by hand
    if (select count(*) from public.port_estate_company x
         where x.company_id = m.company_id and x.location_name = m.location_name) > 1 then
      skipped := skipped || jsonb_build_object('old', m.estate, 'location', m.location_name, 'why', 'several old names');
      continue;
    end if;
    -- the location name already holds data of its own: by hand
    used := false;
    for r in
      select table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'estate' and table_name like 'port\_%' escape '\'
         and table_name not in ('port_estate_company')
         and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
    loop
      execute format('select exists (select 1 from public.%I where estate = $1)', r.table_name) into used using m.location_name;
      exit when used;
    end loop;
    if used or exists (select 1 from public.port_estate_company where estate = m.location_name) then
      skipped := skipped || jsonb_build_object('old', m.estate, 'location', m.location_name, 'why', 'the location name already has data');
      continue;
    end if;
    begin
      for r in
        select table_name from information_schema.columns
         where table_schema = 'public' and column_name = 'estate' and table_name like 'port\_%' escape '\'
           and table_name not in ('port_estate_company')
           and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
      loop
        execute format('update public.%I set estate = $1 where estate = $2', r.table_name) using m.location_name, m.estate;
      end loop;
      -- people's allowed estates (text[] or jsonb)
      select data_type into t from information_schema.columns
       where table_schema = 'public' and table_name = 'port_users' and column_name = 'estates';
      if t = 'ARRAY' then
        execute 'update public.port_users set estates = array_replace(estates, $2, $1) where $2 = any(estates)' using m.location_name, m.estate;
      elsif t = 'jsonb' then
        execute $q$update public.port_users
                    set estates = (select coalesce(jsonb_agg(case when e = $2 then to_jsonb($1) else to_jsonb(e) end), '[]'::jsonb)
                                     from jsonb_array_elements_text(estates) e)
                  where estates ? $2$q$ using m.location_name, m.estate;
      end if;
      -- the old estate list and this list follow
      update public.port_estates set name = m.location_name where name = m.estate
        and not exists (select 1 from public.port_estates where name = m.location_name);
      insert into public.port_estate_company (estate, company_id, matched_by, location_name, location_id, location_matched_by, updated_at)
        values (m.location_name, m.company_id, m.matched_by, m.location_name, m.location_id, m.location_matched_by, now());
      delete from public.port_estate_company where estate = m.estate;
      renamed := renamed || jsonb_build_object('old', m.estate, 'new', m.location_name);
    exception when others then
      skipped := skipped || jsonb_build_object('old', m.estate, 'location', m.location_name, 'why', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('renamed', renamed, 'skipped', skipped);
end;
$$;
revoke all on function public.port_apply_location_names() from public, anon, authenticated;
