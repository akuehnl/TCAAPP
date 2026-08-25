-- Migration 015: a running clock for the meeting.
--
-- Records when the meeting actually began, so the agenda's est_minutes can be
-- laid out as real wall-clock windows and the app can say which item the
-- clock thinks you should be on.
--
-- Anchored to an actual start rather than a nominal hour on purpose: meetings
-- rarely begin on time, and a schedule pinned to "7:00 PM" would report you
-- twelve minutes behind before anyone had spoken.
--
-- Run in the Supabase SQL Editor AFTER migration 014. Safe to re-run.

alter table public.meetings add column if not exists started_at timestamptz;
alter table public.meetings add column if not exists started_by uuid
  references public.members (id) on delete set null;

-- Starting the clock is a running-the-meeting action, like ticking an item
-- off, so any member may do it — the secretary is often the one driving the
-- app while the chair is talking.
create or replace function public.start_meeting(p_meeting_date date)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  stamp timestamptz;
begin
  if not public.is_member() then
    raise exception 'Only board members can start a meeting';
  end if;

  insert into public.meetings (meeting_date, status, started_at, started_by)
  values (p_meeting_date, 'planning', now(), public.my_member_id())
  on conflict (meeting_date) do update
    -- coalesce so a second click cannot restart the clock mid-meeting and
    -- silently reset everyone's timings.
    set started_at = coalesce(public.meetings.started_at, now()),
        started_by = coalesce(public.meetings.started_by, public.my_member_id())
  returning started_at into stamp;

  return stamp;
end;
$$;

-- For a misclick, or a meeting that has to be restarted.
create or replace function public.clear_meeting_start(p_meeting_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_agenda() then
    raise exception 'Only the board chair or an admin can reset the meeting clock';
  end if;

  update public.meetings
     set started_at = null, started_by = null
   where meeting_date = p_meeting_date;
end;
$$;

revoke all on function public.start_meeting(date) from public;
revoke all on function public.clear_meeting_start(date) from public;
grant execute on function public.start_meeting(date) to authenticated;
grant execute on function public.clear_meeting_start(date) to authenticated;
