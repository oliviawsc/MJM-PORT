-- =====================================================================
-- Merge one old estate name into another (by hand, SQL Editor)
--
--   For "several old names → one location": moves every record stored under
--   old_name (all port_* tables with an `estate` column, people's allowed
--   estates) to new_name, then removes old_name from the estate lists.
--   All-or-nothing: if anything fails, nothing is changed and the error is shown.
--
--   select public.port_merge_estate_name('Elewsun', 'Elewsun Sdn Bhd');
-- =====================================================================
create or replace function public.port_merge_estate_name(old_name text, new_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  t text;
  c int;
  moved jsonb := '{}'::jsonb;
  m public.port_estate_company%rowtype;
begin
  if coalesce(trim(old_name), '') = '' or coalesce(trim(new_name), '') = '' or old_name = new_name then
    raise exception 'give two different names';
  end if;
  select * into m from public.port_estate_company where estate = old_name;

  for r in
    select table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'estate' and table_name like 'port\_%' escape '\'
       and table_name not in ('port_estate_company')
       and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
  loop
    execute format('update public.%I set estate = $1 where estate = $2', r.table_name) using new_name, old_name;
    get diagnostics c = row_count;
    if c > 0 then moved := moved || jsonb_build_object(r.table_name, c); end if;
  end loop;

  select data_type into t from information_schema.columns
   where table_schema = 'public' and table_name = 'port_users' and column_name = 'estates';
  if t = 'ARRAY' then
    execute 'update public.port_users set estates = array_remove(array_replace(estates, $2, $1), null) where $2 = any(estates)' using new_name, old_name;
    execute 'update public.port_users set estates = (select array_agg(distinct x) from unnest(estates) x) where $1 = any(estates)' using new_name;
  elsif t = 'jsonb' then
    execute $q$update public.port_users
                set estates = (select coalesce(jsonb_agg(distinct case when e = $2 then $1 else e end), '[]'::jsonb)
                                 from jsonb_array_elements_text(estates) e)
              where estates ? $2$q$ using new_name, old_name;
  end if;

  -- the estate lists: keep new_name, drop old_name
  if not exists (select 1 from public.port_estates where name = new_name) then
    update public.port_estates set name = new_name where name = old_name;
  else
    delete from public.port_estates where name = old_name;
  end if;
  if not exists (select 1 from public.port_estate_company where estate = new_name) and m.estate is not null then
    insert into public.port_estate_company (estate, company_id, matched_by, location_name, location_id, location_matched_by, updated_at)
    values (new_name, m.company_id, m.matched_by, m.location_name, m.location_id, m.location_matched_by, now());
  end if;
  delete from public.port_estate_company where estate = old_name;

  return jsonb_build_object('merged', old_name, 'into', new_name, 'moved', moved);
end;
$$;
revoke all on function public.port_merge_estate_name(text, text) from public, anon, authenticated;
