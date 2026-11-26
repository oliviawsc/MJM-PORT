-- =====================================================================
-- Worker list (PORT → Worker Manage → Worker list): details per worker
--   One row per Mantap worker (port_users.id). Gender and type now; the
--   other columns of the list (passport, SOCSO, levy, …) are added here later.
--   Personal data: read and written only by the mantap-worker-admin Edge
--   Function (service role); no direct access from the pages.
-- Safe to run more than once.
-- =====================================================================
create table if not exists public.port_worker_details (
  user_id      bigint primary key references public.port_users (id) on delete cascade,
  gender       text not null default '' check (gender in ('', 'male', 'female')),
  worker_type  text not null default '' check (worker_type in ('', 'local', 'foreign')),
  updated_by   text not null default '',
  updated_at   timestamptz not null default now()
);
alter table public.port_worker_details enable row level security;
revoke all on public.port_worker_details from anon, authenticated;
