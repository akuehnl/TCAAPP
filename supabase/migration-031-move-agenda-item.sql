-- Migration 031: move one agenda item to another meeting.
--
-- Items could only ever travel forwards, carried automatically when a meeting
-- was closed. So a meeting closed with something mismarked could only be put
-- right with hand-written SQL — which has now happened twice.
--
-- Backwards is the direction that matters here: an item discussed on the 17th
-- but carried to the 24th by mistake has to go back to the meeting it was
-- actually discussed at, or the archive records the wrong evening.
--
-- Marking an item discussed afterwards needs nothing new: the existing
-- set_agenda_item_complete() only ever required membership, never an open
-- meeting, so the archive can use it as it stands.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

create or replace function public.move_agenda_item(item uuid, p_to date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item_status text;
  next_slot integer;
begin
  if not public.can_manage_agenda() then
    raise exception 'Only the board chair or an admin can move an item to another meeting';
  end if;

  if p_to is null then
    raise exception 'Pick a meeting date to move the item to';
  end if;

  select status into item_status from public.agenda_items where id = item;
  if not found then
    raise exception 'That agenda item no longer exists';
  end if;

  -- Approved items are ordered, so the moved one goes to the end of the
  -- target agenda rather than onto a position already spoken for. Suggestions
  -- and declined items are unordered and keep whatever they had.
  select coalesce(max(sort_order) + 1, 0) into next_slot
    from public.agenda_items
   where meeting_date = p_to and status = 'approved';

  update public.agenda_items
     set meeting_date = p_to,
         sort_order = case when item_status = 'approved' then next_slot else sort_order end
   where id = item;
end;
$$;
