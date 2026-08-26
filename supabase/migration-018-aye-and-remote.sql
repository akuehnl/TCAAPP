-- Migration 018: "aye" rather than "yea", and attending via Zoom.
--
-- Run in the Supabase SQL Editor AFTER migration 017. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Votes are recorded as aye / nay / abstain.
--
-- The old constraint has to go before the data can be rewritten, or the
-- update trips over it on the way past.
-- ---------------------------------------------------------------------------

do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.motion_votes'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%yea%'
  loop
    execute format('alter table public.motion_votes drop constraint %I', c.conname);
  end loop;
end;
$$;

update public.motion_votes set vote = 'aye' where vote = 'yea';

alter table public.motion_votes drop constraint if exists motion_votes_vote_check;
alter table public.motion_votes
  add constraint motion_votes_vote_check check (vote in ('aye', 'nay', 'abstain'));

-- ---------------------------------------------------------------------------
-- 2. Attendance gains "present via Zoom".
--
-- Kept distinct from plain "present" rather than folded into it: for a board
-- that meets partly remotely, who was in the room is worth being able to read
-- back off the minutes. Both still count as attending.
-- ---------------------------------------------------------------------------

do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.meeting_attendance'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%excused%'
  loop
    execute format('alter table public.meeting_attendance drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.meeting_attendance drop constraint if exists meeting_attendance_status_check;
alter table public.meeting_attendance
  add constraint meeting_attendance_status_check
  check (status in ('present', 'remote', 'absent', 'excused'));
