-- Migration 017: carry unconsidered suggestions forward too.
--
-- complete_meeting() only moved *approved* items that were not reached. A
-- suggestion the chair never got to was left on the old meeting date, where
-- nobody would see it again without deliberately paging back — so a topic
-- someone raised could quietly vanish.
--
-- Suggestions now always roll forward, whichever way the "carry or archive"
-- prompt is answered. That choice is about items the board consciously
-- decided not to reach; a suggestion that was never considered at all is
-- never something you meant to discard. Declined items stay put — the chair
-- said no to those on purpose.
--
-- Run in the Supabase SQL Editor AFTER migration 016. Safe to re-run.

create or replace function public.complete_meeting(p_meeting_date date, carry_forward boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  carried integer := 0;
  next_date date := p_meeting_date + 7;
  next_start integer;
begin
  if not public.can_manage_agenda() then
    raise exception 'Only the board chair or an admin can close a meeting';
  end if;

  if carry_forward then
    select coalesce(max(sort_order) + 1, 0) into next_start
      from public.agenda_items
     where meeting_date = next_date and status = 'approved';

    -- row_number() cannot appear in an UPDATE ... SET, so rank first in a
    -- CTE and join back to it.
    with ranked as (
      select id,
             (row_number() over (order by sort_order, inserted_at))::integer - 1 as offset_pos
        from public.agenda_items
       where meeting_date = p_meeting_date
         and status = 'approved'
         and completed_at is null
    ),
    moved as (
      update public.agenda_items a
         set meeting_date = next_date,
             sort_order = next_start + r.offset_pos
        from ranked r
       where a.id = r.id
      returning 1
    )
    select count(*) into carried from moved;
  end if;

  -- Suggestions move regardless: they were never considered, so there is no
  -- decision to respect by leaving them behind.
  update public.agenda_items
     set meeting_date = next_date
   where meeting_date = p_meeting_date
     and status = 'suggested';

  insert into public.meetings (meeting_date, status, completed_at, completed_by)
  values (p_meeting_date, 'completed', now(), public.my_member_id())
  on conflict (meeting_date) do update
    set status = 'completed',
        completed_at = now(),
        completed_by = public.my_member_id();

  return carried;
end;
$$;

-- ---------------------------------------------------------------------------
-- One-off rescue: suggestions already stranded on a past meeting date.
--
-- Moves them to the next Tuesday on or after today. Written as a single
-- statement so it is safe to re-run — once they have moved they are no longer
-- in the past, so a second run finds nothing.
-- ---------------------------------------------------------------------------

update public.agenda_items
   set meeting_date = current_date + ((2 - extract(dow from current_date)::int + 7) % 7)
 where status = 'suggested'
   and meeting_date < current_date + ((2 - extract(dow from current_date)::int + 7) % 7);
