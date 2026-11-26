-- The Opispro Location ID of a company without multiple locations (the company
-- itself is its one location), copied from MJM Intranet with the company list.
-- Each Intranet location's own Location ID comes with the locations at sign-in.
-- Safe to run more than once.
alter table public.port_companies add column if not exists location_id text;
