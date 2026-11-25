-- The companies the MJM Intranet gives each person for the Stock icon
-- (business + company access), filled by stock-sso at every sign-in and
-- shown as the company dropdown on the Plantation Operation front page.
-- Safe to run more than once.
alter table public.port_users add column if not exists companies jsonb not null default '[]'::jsonb;
