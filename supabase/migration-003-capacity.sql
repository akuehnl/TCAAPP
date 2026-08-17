-- Migration 003: per-member daily capacity, for the Today overview.
--
-- The overview sums each person's daily load (est_work_hours spread across
-- est_calendar_days) and flags anyone whose scheduled work exceeds what they
-- can realistically absorb in a day.
--
-- Run in the Supabase SQL Editor after migration-002. Safe to re-run — the
-- seeding only happens the first time, so hand-tuned values survive.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'members'
      and column_name = 'daily_capacity_hours'
  ) then
    alter table public.members
      add column daily_capacity_hours numeric(4, 1) not null default 1;

    -- Starting estimates from the bandwidth notes. Tune these once you see
    -- real numbers on the Today page.
    update public.members set daily_capacity_hours = 3 where bandwidth = 'high';
    update public.members set daily_capacity_hours = 1 where bandwidth = 'limited';
  end if;
end;
$$;

-- To adjust later, e.g.:
--   update public.members set daily_capacity_hours = 0.5 where name = 'Josiah';
