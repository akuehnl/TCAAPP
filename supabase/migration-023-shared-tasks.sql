-- Migration 023: tasks assigned to everyone.
--
-- A shared task is ONE row in `todos` with `assign_to_all` set, not a copy per
-- person. That is what makes the due date stay linked without any machinery:
-- there is only one due date, so editing it changes it for everyone by
-- definition. Copies would need a fan-out update to stay in step, and would
-- drift the first time one failed.
--
-- Individual completion then lives in its own table, one row per person who
-- has finished. Nobody's tick affects anybody else's, and "how many are done"
-- is counted from the rows rather than stored, so it cannot drift out of step
-- the way a stored counter would — the same reasoning as the vote tallies in
-- migration 008.
--
-- `todos.is_complete` keeps its meaning for ordinary tasks. On a shared task
-- it is left alone and ignored: whether the board is finished with it is
-- derived from the completion rows.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

alter table public.todos
  add column if not exists assign_to_all boolean not null default false;

-- An assignee and "everyone" are mutually exclusive; allowing both would leave
-- two different answers to "whose task is this?".
alter table public.todos drop constraint if exists todos_assignment_check;
alter table public.todos add constraint todos_assignment_check
  check (not (assign_to_all and assignee_id is not null));

create table if not exists public.todo_completions (
  todo_id uuid not null references public.todos (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  completed_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (todo_id, member_id)
);

create index if not exists todo_completions_todo_idx
  on public.todo_completions (todo_id);

-- ---------------------------------------------------------------------------
-- RLS.
--
-- Everyone sees everyone's progress — that is the point of a shared task, and
-- the board page shows "3 of 5 done". But you may only tick your own box:
-- marking someone else's work finished is not yours to do.
-- ---------------------------------------------------------------------------

alter table public.todo_completions enable row level security;

drop policy if exists "Members view completions" on public.todo_completions;
create policy "Members view completions"
  on public.todo_completions for select
  using (public.is_member());

drop policy if exists "Members tick their own box" on public.todo_completions;
create policy "Members tick their own box"
  on public.todo_completions for insert
  with check (
    public.is_member()
    and auth.uid() = user_id
    and member_id = public.my_member_id()
  );

drop policy if exists "Members untick their own box" on public.todo_completions;
create policy "Members untick their own box"
  on public.todo_completions for delete
  using (member_id = public.my_member_id());
