-- For a project where setup.sql was run while the tables were still called
-- opp_*: renames them to port_* (data kept). Mantap tables keep their names.
-- Safe to run again: tables already renamed are skipped.
do $$
declare t text;
begin
  foreach t in array array[
    'estates','users','items','locations','transactions','manuring_rounds','fieldmaint_rounds',
    'maint_claims','chem_ingredients','rainfall_txns','dashboard_comments','mgmt_monthly'
  ] loop
    if to_regclass('public.opp_' || t) is not null and to_regclass('public.port_' || t) is null then
      execute format('alter table public.%I rename to %I', 'opp_' || t, 'port_' || t);
    end if;
  end loop;
end $$;

-- the estate-rename helper must look at port_* tables
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
