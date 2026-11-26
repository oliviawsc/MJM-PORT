-- Estate Info table: "before" and "after" map dates per estate, and the
-- before values per block (area and palm count at the earlier map date).
create table if not exists public.port_estate_meta (
  estate           text primary key,
  company_id       uuid references public.port_companies (id),
  map_date         date,
  inspection_date  date,
  updated_by       text not null default '',
  updated_at       timestamptz not null default now()
);
alter table public.port_estate_meta add column if not exists prev_map_date date;
alter table public.port_estate_meta enable row level security;
grant select, insert, update, delete on public.port_estate_meta to anon, authenticated;
drop policy if exists port_estate_meta_all on public.port_estate_meta;
create policy port_estate_meta_all on public.port_estate_meta for all to anon, authenticated using (true) with check (true);

alter table public.port_estate_blocks add column if not exists area_ha_prev    numeric(10,2);
alter table public.port_estate_blocks add column if not exists palm_count_prev integer;
