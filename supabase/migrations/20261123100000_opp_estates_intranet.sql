-- =====================================================================
-- Estates follow the MJM Intranet company list
--   opp_estates gains the link to the Intranet company / estate it mirrors.
--   The stock-master-sync Edge Function fills it (called after every sign-in
--   from the Intranet, and from Settings → Estates → "Sync from Intranet").
--   stock_rename_estate() renames an estate everywhere its name is stored
--   (every opp_* table with an `estate` column, plus opp_users.estates).
-- Safe to run more than once.
-- =====================================================================

alter table public.opp_estates
  add column if not exists intranet_id   uuid,          -- gw_company_estates.id, or gw_companies.id when the company is one estate
  add column if not exists intranet_kind text,          -- 'estate' | 'company'
  add column if not exists company_name  text,          -- Intranet company name
  add column if not exists short_name    text,
  add column if not exists is_active     boolean not null default true,
  add column if not exists sort_order    int not null default 0,
  add column if not exists synced_at     timestamptz;
create unique index if not exists opp_estates_intranet_id_idx on public.opp_estates (intranet_id) where intranet_id is not null;

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
  if exists (select 1 from public.opp_estates where name = p_new) then
    raise exception 'estate % already exists', p_new;
  end if;
  -- every opp_* table that stores the estate name in a column called estate
  for r in
    select table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'estate' and table_name like 'opp\_%' escape '\'
  loop
    execute format('update public.%I set estate = $1 where estate = $2', r.table_name) using p_new, p_old;
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  -- opp_users.estates: the estates a user (or Mantap worker) may open — text[] or jsonb
  select data_type into t from information_schema.columns
   where table_schema = 'public' and table_name = 'opp_users' and column_name = 'estates';
  if t = 'ARRAY' then
    execute 'update public.opp_users set estates = array_replace(estates, $2, $1) where $2 = any(estates)' using p_new, p_old;
  elsif t = 'jsonb' then
    execute $q$update public.opp_users
                set estates = (select coalesce(jsonb_agg(case when e = $2 then to_jsonb($1) else to_jsonb(e) end), '[]'::jsonb)
                                 from jsonb_array_elements_text(estates) e)
              where estates ? $2$q$ using p_new, p_old;
  end if;
  update public.opp_estates set name = p_new where name = p_old;
  return n;
end;
$$;
revoke all on function public.stock_rename_estate(text, text) from public, anon, authenticated;
