-- Migration 014: add a 'personnel' calendar category.
--
-- For staff and board absences — who is away and when. Kept separate from the
-- school categories because it is the one kind of calendar entry you filter
-- for a different reason: not "what is the school doing" but "who is here".
--
-- Run in the Supabase SQL Editor AFTER migration 013. Safe to re-run.

-- The original constraint was declared inline, so its name is whatever
-- Postgres assigned. Find it by its definition rather than guessing.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.calendar_events'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%observation%'
  loop
    execute format('alter table public.calendar_events drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.calendar_events
  add constraint calendar_events_category_check
  check (category in (
    'holiday', 'break', 'milestone',
    'fire-drill', 'tornado-drill', 'lockdown-drill',
    'partnership', 'observation', 'personnel', 'other'
  ));
