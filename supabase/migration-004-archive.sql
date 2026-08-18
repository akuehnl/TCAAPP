-- Migration 004: archive completed tasks off the active board.
--
-- Completed tasks stop appearing on the Shared board and My tasks entirely
-- and move to an Archive view grouped by the month they were finished. This
-- replaces the old "Hide done" checkbox, which only filtered the list and
-- would not have held up past the September start.
--
-- Run in the Supabase SQL Editor after migrations 001-003. Safe to re-run.

alter table public.todos add column if not exists completed_at timestamptz;

-- Keep completed_at in step with is_complete no matter who changes it —
-- the app, the SQL editor, or a future import.
create or replace function public.sync_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.is_complete and (tg_op = 'INSERT' or old.is_complete is distinct from new.is_complete) then
    new.completed_at = coalesce(new.completed_at, now());
  elsif not new.is_complete then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists todos_sync_completed_at on public.todos;
create trigger todos_sync_completed_at
  before insert or update on public.todos
  for each row execute function public.sync_completed_at();

-- Backfill anything already marked done. Real completion dates were never
-- recorded, so fall back to the due date — tasks tend to get finished near
-- when they were due, which groups the archive into sensible months. Rows
-- with no due date fall back to when they were last touched.
update public.todos
   set completed_at = coalesce(due_date::timestamptz, updated_at, inserted_at)
 where is_complete
   and completed_at is null;

create index if not exists todos_completed_at_idx
  on public.todos (completed_at desc) where is_complete;
