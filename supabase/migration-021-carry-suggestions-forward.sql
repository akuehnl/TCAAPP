-- Migration 021: make carrying suggestions forward reliable.
--
-- Migration 017 already rolled unconsidered suggestions to the next meeting
-- when one was closed, but it had two ways to strand an item anyway:
--
--   1. It moved them to `p_meeting_date + 7` — one week on from the meeting
--      being closed, not the next meeting that is actually still ahead. Close
--      a meeting late (a week or more after it was held, which is normal when
--      the chair tidies up afterwards) and the items land on a date that is
--      itself already in the past. Nobody sees them again.
--
--   2. It only swept suggestions sitting exactly on the meeting being closed.
--      Anything already stranded on an earlier date stayed stranded, so one
--      missed close left an item behind permanently.
--
-- Both are fixed below: items land on the next meeting on or after today, and
-- every suggestion up to and including the closing date is swept forward.
--
-- This migration is self-contained — it does not matter whether 017 was ever
-- run, and it is safe to re-run.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The next meeting on or after a given date.
--
-- Board meetings are Tuesdays (dow 2), which the frontend also assumes in
-- upcomingMeeting(). On a Tuesday this returns that same Tuesday, so a
-- meeting closed on the morning of its own date does not skip a week.
-- ---------------------------------------------------------------------------

create or replace function public.next_meeting_on_or_after(d date)
returns date
language sql
immutable
as $$
  select d + ((2 - extract(dow from d)::int + 7) % 7);
$$;

-- ---------------------------------------------------------------------------
-- 2. Closing a meeting.
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

  -- A week on from the meeting being closed, but never a date that has
  -- already passed: closing an old meeting must not park items in the past.
  next_date := greatest(
    p_meeting_date + 7,
    public.next_meeting_on_or_after(current_date)
  );

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
  -- `<=` rather than `=` also sweeps up anything stranded by an earlier close,
  -- so one missed meeting cannot bury a topic for good.
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

-- ---------------------------------------------------------------------------
-- 3. Rescue: suggestions already stranded on a past meeting date.
--
-- Moves every one of them onto the next meeting still ahead. Written as a
-- single statement so it is safe to re-run — once moved they are no longer in
-- the past, so a second run finds nothing.
-- ---------------------------------------------------------------------------

update public.agenda_items
   set meeting_date = public.next_meeting_on_or_after(current_date)
 where status = 'suggested'
   and meeting_date < public.next_meeting_on_or_after(current_date);
