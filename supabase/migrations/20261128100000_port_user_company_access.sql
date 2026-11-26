-- =====================================================================
-- User Access per company
--   Each person's role and None / View / Edit per page are set for ONE
--   company at a time (PORT → User Access, company chosen in the top bar).
--   A company with no row here falls back to the person's old global access
--   in port_users.permissions, so nothing changes until it is set.
-- Safe to run more than once.
-- =====================================================================
create table if not exists public.port_user_company_access (
  email        text not null check (email = lower(email)),
  company_id   uuid not null references public.port_companies (id) on delete cascade,
  role         text not null default 'hq_user' check (role in ('admin', 'hq_user', 'estate_user')),
  permissions  jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'), -- { section: 'view' | 'edit' }
  status       text not null default 'active' check (status in ('active', 'inactive')),
  updated_by   text not null default '',
  updated_at   timestamptz not null default now(),
  primary key (email, company_id)
);
create index if not exists port_user_company_access_company_idx on public.port_user_company_access (company_id);

-- Written only by the Edge Functions; each person may read their own rows
alter table public.port_user_company_access enable row level security;
revoke all on public.port_user_company_access from anon, authenticated;
grant select on public.port_user_company_access to authenticated;
drop policy if exists port_user_company_access_read on public.port_user_company_access;
create policy port_user_company_access_read on public.port_user_company_access for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- FFB Production records get the Intranet company id too (filled from the estate name)
do $$
declare t text;
begin
  foreach t in array array['port_ffb_production'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I add column if not exists company_id uuid references public.port_companies (id)', t);
    execute format('create index if not exists %I on public.%I (company_id)', t || '_company_idx', t);
    execute format('drop trigger if exists port_fill_company_id on public.%I', t);
    execute format('create trigger port_fill_company_id before insert or update of estate, company_id on public.%I '
                   'for each row execute function public.port_fill_company_id()', t);
    execute format('update public.%I d set company_id = m.company_id from public.port_estate_company m
                     where d.company_id is null and m.company_id is not null and d.estate = m.estate', t);
  end loop;
end $$;
