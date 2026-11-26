-- Worker list: Worker ID and Opispro Worker ID per worker (set in the worker's profile),
-- and a locked copy of the MANTAP PIN so the eye button can show it.
-- Safe to run more than once.
alter table public.port_worker_details add column if not exists worker_no  text not null default '';
alter table public.port_worker_details add column if not exists opispro_id text not null default '';
alter table public.port_worker_details add column if not exists pin_locked text;  -- locked (AES-GCM) copy of the MANTAP PIN, Edge Functions only
