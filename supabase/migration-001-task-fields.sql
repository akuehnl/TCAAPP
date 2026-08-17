-- Migration 001: expand `todos` from a single-text to-do into a task record.
--
-- Run this in the Supabase SQL Editor if you already created the `todos`
-- table with the original schema.sql. It is safe to run more than once and
-- preserves any existing rows.

-- 1. Rename `task` -> `title` (only if it hasn't happened yet).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'todos' and column_name = 'task'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'todos' and column_name = 'title'
  ) then
    alter table public.todos rename column task to title;
  end if;
end;
$$;

-- 2. Add the new fields.
alter table public.todos add column if not exists assignee text;
alter table public.todos add column if not exists due_date date;
alter table public.todos add column if not exists priority text not null default 'medium';
alter table public.todos add column if not exists est_work_hours numeric(6, 2);
alter table public.todos add column if not exists est_calendar_days numeric(6, 1);
alter table public.todos add column if not exists project_label text;
alter table public.todos add column if not exists notes text;
alter table public.todos add column if not exists updated_at timestamptz not null default now();

-- 3. Constrain priority to the three allowed values.
alter table public.todos drop constraint if exists todos_priority_check;
alter table public.todos
  add constraint todos_priority_check check (priority in ('low', 'medium', 'high'));

-- 4. Keep updated_at current on every edit.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at
  before update on public.todos
  for each row execute function public.set_updated_at();
