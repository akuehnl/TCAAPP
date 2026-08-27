-- Migration 019: a second meeting link for Concordis.
--
-- Run in the Supabase SQL Editor AFTER migration 018. Safe to re-run: the
-- conflict clause leaves an edited value alone, so re-running never overwrites
-- a link someone has since changed in the app.

insert into public.app_settings (key, value)
values ('concordis_zoom_url', 'https://concordispartners.zoom.us/my/heatherlloyd.concordis')
on conflict (key) do nothing;
