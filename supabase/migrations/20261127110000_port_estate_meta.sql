-- Estate Info: the dates at the top of the block list (map date, inspection date)
create table if not exists public.port_estate_meta (
  estate           text primary key,
  company_id       uuid references public.port_companies (id),
  map_date         date,
  inspection_date  date,
  updated_by       text not null default '',
  updated_at       timestamptz not null default now()
);
alter table public.port_estate_meta enable row level security;
grant select, insert, update, delete on public.port_estate_meta to anon, authenticated;
drop policy if exists port_estate_meta_all on public.port_estate_meta;
create policy port_estate_meta_all on public.port_estate_meta for all to anon, authenticated using (true) with check (true);
