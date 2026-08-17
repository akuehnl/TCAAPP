-- Run this in the Supabase SQL Editor (Project -> SQL Editor -> New query)
-- for a fresh project. Safe to run once.

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task text not null,
  is_complete boolean not null default false,
  inserted_at timestamptz not null default now()
);

-- Row Level Security: each user can only see/change their own rows.
alter table public.todos enable row level security;

create policy "Users can view their own todos"
  on public.todos for select
  using (auth.uid() = user_id);

create policy "Users can insert their own todos"
  on public.todos for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own todos"
  on public.todos for update
  using (auth.uid() = user_id);

create policy "Users can delete their own todos"
  on public.todos for delete
  using (auth.uid() = user_id);

-- Enable realtime updates for the table (optional, used by app.js).
alter publication supabase_realtime add table public.todos;
