-- Run this in the Supabase SQL Editor (Project -> SQL Editor -> New query)
-- for a FRESH project. If you already ran an earlier version of this file,
-- run supabase/migration-001-task-fields.sql instead.

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Core
  title text not null,
  is_complete boolean not null default false,   -- status: false = open, true = done

  -- Planning
  assignee text,                                -- board member or helper
  due_date date,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high')),
  est_work_hours numeric(6, 2),                 -- actual hands-on effort
  est_calendar_days numeric(6, 1),              -- wall-clock time, incl. waiting on others

  -- Optional
  project_label text,
  notes text,

  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep updated_at current on every edit.
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

-- Row Level Security: each user can only see/change their own rows.
alter table public.todos enable row level security;

drop policy if exists "Users can view their own todos" on public.todos;
create policy "Users can view their own todos"
  on public.todos for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own todos" on public.todos;
create policy "Users can insert their own todos"
  on public.todos for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own todos" on public.todos;
create policy "Users can update their own todos"
  on public.todos for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete their own todos" on public.todos;
create policy "Users can delete their own todos"
  on public.todos for delete
  using (auth.uid() = user_id);

-- Enable realtime updates for the table (used by app.js).
do $$
begin
  alter publication supabase_realtime add table public.todos;
exception
  when duplicate_object then null;
end;
$$;
