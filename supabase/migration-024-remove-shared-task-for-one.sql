-- Migration 024: let one person drop off a shared task.
--
-- A task assigned to everyone is a single row, so deleting it deletes it for
-- the whole board. That is right when the task itself is wrong, and wrong when
-- it simply does not apply to you — and until now there was no way to say the
-- second thing.
--
-- `todo_completions` already holds one row per person per shared task, meaning
-- "this is settled for me". That was only ever true for one reason, so the
-- reason was implicit. It is now recorded:
--
--   done    — I finished it. Shows in my Archive, counts toward "3 of 5 done".
--   removed — it does not apply to me. Off my lists entirely, counts toward
--             nobody being owed it, but is not an achievement and is not
--             filed in my Archive.
--
-- Either way the task leaves that person's board, and the shared row itself is
-- untouched — everyone else's copy carries on exactly as before.
--
-- Run in the Supabase SQL Editor after migration 023. Safe to re-run.

alter table public.todo_completions
  add column if not exists state text not null default 'done';

-- Added separately rather than inline, so re-running finds the column already
-- there and still reasserts the constraint.
alter table public.todo_completions drop constraint if exists todo_completions_state_check;
alter table public.todo_completions add constraint todo_completions_state_check
  check (state in ('done', 'removed'));

-- Changing your mind — ticking a task you had dropped, or dropping one you had
-- ticked — rewrites your existing row rather than adding a second, so this
-- needs an UPDATE policy alongside the insert and delete ones from 023. Still
-- your own row only: `state` is no more yours to set on someone else's row
-- than the row itself was.
drop policy if exists "Members change their own box" on public.todo_completions;
create policy "Members change their own box"
  on public.todo_completions for update
  using (member_id = public.my_member_id())
  with check (member_id = public.my_member_id());
