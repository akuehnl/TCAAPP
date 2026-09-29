-- Migration 026: recurring tasks.
--
-- A recurring task is one open task at a time, not a year of rows created up
-- front. Finishing it creates the next one. That keeps the board showing what
-- is actually due, means changing the wording or the assignee affects every
-- future occurrence rather than only the ones not yet generated, and cannot
-- fill the archive with occurrences nobody ever looked at.
--
-- The next occurrence is created by a trigger rather than by the browser, so
-- it happens exactly once no matter who ticks the box or whether their tab is
-- open long enough to follow up.
--
-- Run in the Supabase SQL Editor after migration 024. Safe to re-run.

alter table public.todos add column if not exists repeat_every integer;
alter table public.todos add column if not exists repeat_unit text;

-- Which task this one was generated from. Its real job is to stop a second
-- occurrence being created: unticking a completed task and ticking it again
-- would otherwise spawn another one every time.
alter table public.todos add column if not exists repeat_parent_id uuid
  references public.todos (id) on delete set null;

alter table public.todos drop constraint if exists todos_repeat_check;
alter table public.todos add constraint todos_repeat_check check (
  (repeat_every is null and repeat_unit is null)
  or (repeat_every > 0 and repeat_unit in ('day', 'week', 'month', 'year'))
);

create index if not exists todos_repeat_parent_idx on public.todos (repeat_parent_id);

-- ---------------------------------------------------------------------------
-- Creating the next occurrence.
-- ---------------------------------------------------------------------------

create or replace function public.spawn_recurrence(source public.todos)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  step interval;
  next_due date;
  guard integer := 0;
begin
  if source.repeat_every is null or source.repeat_unit is null then
    return;
  end if;

  -- Already done for this occurrence.
  if exists (select 1 from public.todos where repeat_parent_id = source.id) then
    return;
  end if;

  step := (source.repeat_every::text || ' ' || source.repeat_unit)::interval;

  -- Counted from the due date, not from when it was finished, so a task done
  -- three days late still lands on its normal schedule rather than drifting
  -- later every time. An undated task has nothing to count from, so it starts
  -- from today.
  next_due := coalesce(source.due_date, current_date) + step;

  -- A task finished long after it was due could otherwise produce an
  -- occurrence that is itself already overdue. The guard bounds the loop in
  -- case of an interval that somehow fails to advance.
  while next_due <= current_date and guard < 500 loop
    next_due := next_due + step;
    guard := guard + 1;
  end loop;

  insert into public.todos (
    user_id, title, notes, project_label, priority,
    assignee_id, assign_to_all, due_date,
    est_work_hours, est_calendar_days,
    repeat_every, repeat_unit, repeat_parent_id, is_complete
  ) values (
    source.user_id, source.title, source.notes, source.project_label, source.priority,
    source.assignee_id, source.assign_to_all, next_due,
    source.est_work_hours, source.est_calendar_days,
    source.repeat_every, source.repeat_unit, source.id, false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- An ordinary task: the next one appears when it is ticked.
-- ---------------------------------------------------------------------------

create or replace function public.todos_recurrence_tick()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_complete and not old.is_complete and not new.assign_to_all then
    perform public.spawn_recurrence(new);
  end if;
  return null;
end;
$$;

drop trigger if exists todos_spawn_recurrence on public.todos;
create trigger todos_spawn_recurrence
  after update on public.todos
  for each row execute function public.todos_recurrence_tick();

-- ---------------------------------------------------------------------------
-- A shared task: the next one appears when the last person settles it.
--
-- `is_complete` is never set on a shared task, so the trigger above would
-- never fire for one. Settled, not finished: someone who dropped the task is
-- never going to tick it, and waiting on them would stop the series dead.
-- ---------------------------------------------------------------------------

create or replace function public.completions_recurrence_tick()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  task public.todos;
  active_count integer;
  settled_count integer;
begin
  select * into task from public.todos where id = new.todo_id;
  if not found or not task.assign_to_all or task.repeat_every is null then
    return null;
  end if;

  select count(*) into active_count from public.members where is_active;

  select count(*) into settled_count
    from public.todo_completions c
    join public.members m on m.id = c.member_id and m.is_active
   where c.todo_id = task.id;

  if active_count > 0 and settled_count >= active_count then
    perform public.spawn_recurrence(task);
  end if;
  return null;
end;
$$;

drop trigger if exists completions_spawn_recurrence on public.todo_completions;
create trigger completions_spawn_recurrence
  after insert or update on public.todo_completions
  for each row execute function public.completions_recurrence_tick();
