-- Migration 025: move a meeting to a different date.
--
-- Meetings have been weekly Tuesdays everywhere: the date is the key, and the
-- app worked out the next one arithmetically. That breaks the first time the
-- board meets on a Wednesday — there was no way to say so.
--
-- A meeting's date is its identity, spread across three tables, so moving one
-- means moving all three together. That is exactly what a function is for: do
-- it in the browser and a failure halfway through would leave the agenda on
-- one date and the attendance on another.
--
-- Run in the Supabase SQL Editor after migration 021. Safe to re-run.

create or replace function public.reschedule_meeting(p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_agenda() then
    raise exception 'Only the board chair or an admin can move a meeting';
  end if;

  if p_to is null then
    raise exception 'Pick a date to move the meeting to';
  end if;

  if p_from = p_to then
    return;
  end if;

  -- Refused rather than merged. Two meetings' agendas landing in one pile is
  -- not something the chair can undo, and "move it onto the same day as
  -- another meeting" is much more likely to be a typo than an intention.
  if exists (select 1 from public.agenda_items where meeting_date = p_to)
     or exists (select 1 from public.meetings where meeting_date = p_to) then
    raise exception 'There is already a meeting on %. Move or clear that one first.', p_to;
  end if;

  update public.agenda_items set meeting_date = p_to where meeting_date = p_from;
  update public.meeting_attendance set meeting_date = p_to where meeting_date = p_from;
  update public.meetings set meeting_date = p_to where meeting_date = p_from;
end;
$$;

-- ---------------------------------------------------------------------------
-- Carrying items forward now aims at the next meeting that actually exists.
--
-- Migration 021 worked out the target arithmetically — a week on, never in the
-- past. That is still the fallback, but if the board has already scheduled its
-- next meeting (on a Wednesday, say), unfinished business belongs on *that*
-- date rather than on whatever day the arithmetic produces.
-- ---------------------------------------------------------------------------

create or replace function public.complete_meeting(p_meeting_date date, carry_forward boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  carried integer := 0;
  next_date date;
  next_start integer;
begin
  if not public.can_manage_agenda() then
    raise exception 'Only the board chair or an admin can close a meeting';
  end if;

  -- The soonest meeting already on the books after this one, whether that is
  -- a `meetings` row or just a date some agenda items are sitting on.
  select min(d) into next_date
    from (
      select meeting_date as d from public.meetings where meeting_date > p_meeting_date
      union all
      select meeting_date from public.agenda_items where meeting_date > p_meeting_date
    ) scheduled;

  -- Nothing scheduled, or the only thing scheduled has itself already passed:
  -- fall back to a week on, but never onto a date that is already behind us.
  if next_date is null or next_date < current_date then
    next_date := greatest(
      p_meeting_date + 7,
      public.next_meeting_on_or_after(current_date)
    );
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

  -- Suggestions move regardless of the carry/archive answer: they were never
  -- considered, so there is no decision to respect by leaving them behind.
  -- `<=` rather than `=` also sweeps up anything stranded by an earlier close.
  update public.agenda_items
     set meeting_date = next_date
   where meeting_date <= p_meeting_date
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
