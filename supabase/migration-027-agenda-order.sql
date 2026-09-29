-- Migration 027: save a whole agenda order in one call.
--
-- Reordering with the up/down buttons writes one row at a time: moving an
-- item three places is three round trips, and a failure partway through
-- leaves two items claiming the same position. Dragging an item across a long
-- agenda would make that worse, so the new order is sent as a list and
-- applied in a single statement.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

create or replace function public.set_agenda_order(p_meeting_date date, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_agenda() then
    raise exception 'Only the board chair or an admin can reorder the agenda';
  end if;

  -- Position in the array is the new sort order. The meeting date and status
  -- are checked here rather than trusted from the caller, so a stale or
  -- tampered list cannot pull an item off another meeting's agenda.
  update public.agenda_items a
     set sort_order = pos.idx - 1
    from unnest(p_ids) with ordinality as pos(id, idx)
   where a.id = pos.id
     and a.meeting_date = p_meeting_date
     and a.status = 'approved';
end;
$$;
