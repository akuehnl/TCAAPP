-- Migration 013: the school calendar.
--
-- Holidays, breaks, milestones, safety drills, Parent Partnership days and the
-- classroom observation schedule. Board meetings and task due dates are
-- deliberately NOT mirrored here — they have their own sections, and pulling
-- them in would mean two places to change one date.
--
-- Run in the Supabase SQL Editor AFTER migration 012. Safe to re-run.

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  description text,

  -- ends_on null means a single day. Stored as a range rather than one row
  -- per day so that editing Thanksgiving Break is one edit, not five.
  starts_on date not null,
  ends_on date,

  -- Most school events are all-day; times are there for the occasional
  -- evening event like Back to School Night.
  start_time time,
  end_time time,

  -- Mirrors the colour coding on the printed calendar, including keeping the
  -- three drill types apart: how many of each has been run is a compliance
  -- question, not a cosmetic one.
  category text not null default 'other'
    check (category in (
      'holiday', 'break', 'milestone',
      'fire-drill', 'tornado-drill', 'lockdown-drill',
      'partnership', 'observation', 'other'
    )),

  created_by uuid references public.members (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint calendar_end_after_start check (ends_on is null or ends_on >= starts_on)
);

create index if not exists calendar_events_start_idx on public.calendar_events (starts_on);

drop trigger if exists calendar_events_set_updated_at on public.calendar_events;
create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: any board member may add and edit, matching how tasks and minutes
-- already work.
-- ---------------------------------------------------------------------------

alter table public.calendar_events enable row level security;

drop policy if exists "Members view the calendar" on public.calendar_events;
create policy "Members view the calendar"
  on public.calendar_events for select using (public.is_member());

drop policy if exists "Members add calendar events" on public.calendar_events;
create policy "Members add calendar events"
  on public.calendar_events for insert
  with check (public.is_member() and auth.uid() = user_id);

drop policy if exists "Members edit calendar events" on public.calendar_events;
create policy "Members edit calendar events"
  on public.calendar_events for update
  using (public.is_member()) with check (public.is_member());

drop policy if exists "Members delete calendar events" on public.calendar_events;
create policy "Members delete calendar events"
  on public.calendar_events for delete
  using (public.is_member());

do $$
begin
  alter publication supabase_realtime add table public.calendar_events;
exception when duplicate_object then null;
end;
$$;
