-- Migration 010: meeting attendance.
--
-- Recorded at the start of each meeting: who was present, absent or excused,
-- plus write-ins for anyone attending who is not on the roster (a parent, a
-- vendor, a prospective board member).
--
-- Run in the Supabase SQL Editor AFTER migration 009. Safe to re-run.

create table if not exists public.meeting_attendance (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null,

  -- Exactly one of these: a roster member, or a written-in guest.
  member_id uuid references public.members (id) on delete cascade,
  guest_name text,

  status text not null default 'present'
    check (status in ('present', 'absent', 'excused')),
  note text,

  recorded_by uuid references public.members (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint attendance_member_or_guest check (
    (member_id is not null and guest_name is null)
    or (member_id is null and guest_name is not null and btrim(guest_name) <> '')
  )
);

-- A roster member appears at most once per meeting; guests may repeat, since
-- two different visitors could share a first name.
create unique index if not exists attendance_member_uniq
  on public.meeting_attendance (meeting_date, member_id)
  where member_id is not null;

create index if not exists attendance_meeting_idx
  on public.meeting_attendance (meeting_date);

drop trigger if exists attendance_set_updated_at on public.meeting_attendance;
create trigger attendance_set_updated_at
  before update on public.meeting_attendance
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: taking attendance is minute-keeping, so it is open to any member
-- rather than the chair alone — same reasoning as notes and motions.
-- ---------------------------------------------------------------------------

alter table public.meeting_attendance enable row level security;

drop policy if exists "Members view attendance" on public.meeting_attendance;
create policy "Members view attendance"
  on public.meeting_attendance for select using (public.is_member());

drop policy if exists "Members record attendance" on public.meeting_attendance;
create policy "Members record attendance"
  on public.meeting_attendance for insert
  with check (public.is_member() and auth.uid() = user_id);

drop policy if exists "Members amend attendance" on public.meeting_attendance;
create policy "Members amend attendance"
  on public.meeting_attendance for update
  using (public.is_member()) with check (public.is_member());

drop policy if exists "Members clear attendance" on public.meeting_attendance;
create policy "Members clear attendance"
  on public.meeting_attendance for delete
  using (public.is_member());

do $$
begin
  alter publication supabase_realtime add table public.meeting_attendance;
exception when duplicate_object then null;
end;
$$;
