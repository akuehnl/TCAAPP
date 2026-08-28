-- Migration 020: the shared Drive folder link.
--
-- Run in the Supabase SQL Editor AFTER migration 019. Safe to re-run: the
-- conflict clause leaves an edited value alone, so re-running never overwrites
-- a link someone has since changed in the app.

insert into public.app_settings (key, value)
values ('drive_url', 'https://drive.google.com/drive/folders/1p2LtrniEs6xc3CVce02XuvOz_K5fbGiL?usp=drive_link')
on conflict (key) do nothing;
