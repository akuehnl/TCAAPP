-- Migration 022: take Elise and Kate off the roster.
--
-- They were added by seed-001 so that tasks carried over from the old list
-- kept the name they were assigned to. Neither ever had an email or an
-- account, so there is no sign-in to revoke — this is purely a roster change.
--
-- What happens to their tasks: `todos.assignee_id` is `on delete set null`,
-- so their tasks become unassigned rather than being deleted. They stay on the
-- shared board and show up in the Today page's "Unassigned" card, so nothing
-- disappears — but somebody has to pick them up. The final SELECT lists
-- exactly which tasks those are, so run this and read the result.
--
-- Deactivating instead of deleting was the other option, and it is worse here:
-- the app only loads active members, so their tasks would render as
-- "Unassigned" while still holding a link to a hidden member, and they would
-- vanish from the Today page entirely rather than moving to the Unassigned
-- card. Removing them outright keeps the data honest.
--
-- Run in the Supabase SQL Editor. Safe to re-run — a second run finds nobody
-- and reports nothing.

-- Captured before the delete, because afterwards there is no way to tell which
-- tasks were theirs.
-- Dropped first rather than declared ON COMMIT DROP, so this behaves the same
-- whether the editor wraps the script in one transaction or runs each
-- statement in its own.
drop table if exists released_tasks;

create temp table released_tasks as
select
  m.name        as was_assigned_to,
  t.title,
  t.due_date,
  t.is_complete,
  t.project_label
from public.todos t
join public.members m on m.id = t.assignee_id
where m.name in ('Elise', 'Kate');

delete from public.members
 where name in ('Elise', 'Kate');

-- Read this. Every open row here is now unassigned and needs an owner.
select
  was_assigned_to,
  title,
  due_date,
  case when is_complete then 'done' else 'OPEN — needs reassigning' end as state,
  project_label
from released_tasks
order by is_complete, due_date nulls last;
