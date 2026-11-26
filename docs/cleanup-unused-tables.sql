-- =====================================================================
-- Plantation Operation: remove tables nothing uses any more (run by hand, once)
--
--   port_estate_tables, port_estate_records
--       the old Estate Info "make your own tables" feature; Estate Info no
--       longer has it and no page reads or writes these tables.
--
--   Not removed yet: port_estates (old estate list). The old Stock app still
--   uses it; remove it when the Stock app no longer does.
--
-- 1) Look first: how many rows they still have
--      select (select count(*) from public.port_estate_tables)  as tables,
--             (select count(*) from public.port_estate_records) as records;
-- 2) Then remove them. This cannot be undone.
-- =====================================================================
drop table if exists public.port_estate_records;
drop table if exists public.port_estate_tables;
