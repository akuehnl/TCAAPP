-- Migration 002: board roster + shared board visibility.
--
-- Changes the app from "private per-user to-do lists" to "one shared board
-- that five members can all see, with tasks assigned to a named member".
-- This is what makes assignment (and assignment emails) meaningful.
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
-- Requires migration-001 to have been run first.

-- ---------------------------------------------------------------------------
-- 1. Board roster. Independent of auth.users, so people can be assigned
--    tasks before they ever create an account.
-- ---------------------------------------------------------------------------

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,        -- short display name used in the UI
  full_name text,                   -- used in the "To:" line on digest emails
  email text unique,                -- required for digest emails
  role text,
  bandwidth text check (bandwidth in ('high', 'limited')),
  notes text,
  user_id uuid unique references auth.users (id) on delete set null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  inserted_at timestamptz not null default now()
);

-- Seed the five board members. `on conflict` keeps this re-runnable.
insert into public.members (name, full_name, email, role, bandwidth, notes, sort_order) values
  ('Aden',   'Aden Kuehnl',     'adenkuehnl@gmail.com',        'Treasurer',       'high',    'Also handles marketing.', 1),
  ('Isaac',  'Isaac Boyd',      'iboyd35@yahoo.com',           'Board Oversight', 'high',    'Most business and legal acumen; led lease negotiation. Organizes tasks.', 2),
  ('Josiah', 'Josiah Warner',   'josiahswarner@yahoo.com',     'Board Chair',     'limited', 'Decision-making and culture. Enrollment and hiring.', 3),
  ('Ethan',  'Ethan Nelson',    'ethannelson9974@gmail.com',   'Secretary',       'limited', 'Vendor contracts — signage, security camera systems.', 4),
  ('Joe',    'Joseph Martinez', 'joe.m.martinez3250@gmail.com', 'Board Oversight', 'limited', 'Retired, so available for physical errands and supply runs. Church outreach, theology.', 5)
on conflict (name) do update set
  full_name = excluded.full_name,
  email = excluded.email,
  role = excluded.role,
  bandwidth = excluded.bandwidth,
  notes = excluded.notes,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 3. Point tasks at a roster member instead of a free-text name.
-- ---------------------------------------------------------------------------

alter table public.todos
  add column if not exists assignee_id uuid references public.members (id) on delete set null;

-- Carry over any free-text assignee values that match a member by name.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'todos' and column_name = 'assignee'
  ) then
    update public.todos t
      set assignee_id = m.id
      from public.members m
      where t.assignee_id is null
        and t.assignee is not null
        and lower(trim(t.assignee)) = lower(m.name);

    alter table public.todos drop column assignee;
  end if;
end;
$$;

create index if not exists todos_assignee_id_idx on public.todos (assignee_id);
create index if not exists todos_due_date_idx on public.todos (due_date) where is_complete = false;

-- ---------------------------------------------------------------------------
-- 4. Link a member to their login automatically when they sign up.
-- ---------------------------------------------------------------------------

create or replace function public.link_member_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.members
     set user_id = new.id
   where user_id is null
     and email is not null
     and lower(email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_member_on_signup();

-- Backfill for anyone who already signed up before this migration.
update public.members m
   set user_id = u.id
  from auth.users u
 where m.user_id is null
   and m.email is not null
   and lower(m.email) = lower(u.email);

-- ---------------------------------------------------------------------------
-- 5. Shared-board RLS.
--
--    SECURITY DEFINER is what keeps this from recursing: the function runs as
--    the table owner, so its own read of `members` skips RLS.
-- ---------------------------------------------------------------------------

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
     where user_id = auth.uid() and is_active
  );
$$;

alter table public.members enable row level security;

drop policy if exists "Members can view the roster" on public.members;
create policy "Members can view the roster"
  on public.members for select
  using (public.is_member());

-- No insert/update/delete policies on members: the roster is managed here in
-- the SQL editor, not from the browser.

-- Replace the old owner-only task policies with member-wide ones.
drop policy if exists "Users can view their own todos" on public.todos;
drop policy if exists "Users can insert their own todos" on public.todos;
drop policy if exists "Users can update their own todos" on public.todos;
drop policy if exists "Users can delete their own todos" on public.todos;

drop policy if exists "Members can view all tasks" on public.todos;
create policy "Members can view all tasks"
  on public.todos for select
  using (public.is_member());

drop policy if exists "Members can create tasks" on public.todos;
create policy "Members can create tasks"
  on public.todos for insert
  with check (public.is_member() and auth.uid() = user_id);

drop policy if exists "Members can update any task" on public.todos;
create policy "Members can update any task"
  on public.todos for update
  using (public.is_member());

drop policy if exists "Members can delete any task" on public.todos;
create policy "Members can delete any task"
  on public.todos for delete
  using (public.is_member());

-- Let the roster stream to the browser alongside tasks.
do $$
begin
  alter publication supabase_realtime add table public.members;
exception
  when duplicate_object then null;
end;
$$;
