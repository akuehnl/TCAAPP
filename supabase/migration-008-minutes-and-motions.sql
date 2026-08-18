-- Migration 008: meeting minutes, motions and votes, and completed meetings.
--
-- Minutes are notes recorded under an approved agenda item during discussion.
-- Motions live in their own table rather than on the agenda item, because a
-- motion can be raised on any item during the meeting whether or not it was
-- flagged as one when suggested — and an item can carry more than one.
--
-- This also introduces a real `meetings` table. Until now a meeting was just a
-- date on each agenda item, which was enough while nothing needed to be
-- recorded *about* the meeting itself. Marking one complete is per-meeting
-- state, so it needs somewhere to live.
--
-- Run in the Supabase SQL Editor after migration 007. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Meetings.
-- ---------------------------------------------------------------------------

create table if not exists public.meetings (
  meeting_date date primary key,
  status text not null default 'planning' check (status in ('planning', 'completed')),
  completed_at timestamptz,
  completed_by uuid references public.members (id) on delete set null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists meetings_set_updated_at on public.meetings;
create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function public.set_updated_at();

-- Agenda items get their own completion mark, separate from `status`: an item
-- is both "approved" and, once discussed, "complete".
alter table public.agenda_items add column if not exists completed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Minutes.
-- ---------------------------------------------------------------------------

create table if not exists public.agenda_notes (
  id uuid primary key default gen_random_uuid(),
  agenda_item_id uuid not null references public.agenda_items (id) on delete cascade,
  body text not null,
  author_id uuid references public.members (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agenda_notes_item_idx on public.agenda_notes (agenda_item_id, inserted_at);

drop trigger if exists agenda_notes_set_updated_at on public.agenda_notes;
create trigger agenda_notes_set_updated_at
  before update on public.agenda_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Motions and votes.
--
-- Votes are recorded per person (yea / nay / abstain) rather than as bare
-- tallies, so the minutes show how each member voted. Tallies are derived by
-- counting rows, which keeps them from drifting out of step with the roll
-- call the way a stored count would.
-- ---------------------------------------------------------------------------

create table if not exists public.motions (
  id uuid primary key default gen_random_uuid(),
  agenda_item_id uuid not null references public.agenda_items (id) on delete cascade,

  motion_text text not null,
  moved_by uuid references public.members (id) on delete set null,
  seconded_by uuid references public.members (id) on delete set null,

  outcome text not null default 'pending'
    check (outcome in ('pending', 'carried', 'failed', 'tabled', 'withdrawn')),

  recorded_by uuid references public.members (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per member per motion. The primary key enforces that a member
-- cannot be recorded voting twice on the same motion; changing a vote is an
-- upsert, and clearing it deletes the row.
create table if not exists public.motion_votes (
  motion_id uuid not null references public.motions (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  vote text not null check (vote in ('yea', 'nay', 'abstain')),
  recorded_by uuid references public.members (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (motion_id, member_id)
);

create index if not exists motion_votes_motion_idx on public.motion_votes (motion_id);

drop trigger if exists motion_votes_set_updated_at on public.motion_votes;
create trigger motion_votes_set_updated_at
  before update on public.motion_votes
  for each row execute function public.set_updated_at();

create index if not exists motions_item_idx on public.motions (agenda_item_id, inserted_at);

drop trigger if exists motions_set_updated_at on public.motions;
create trigger motions_set_updated_at
  before update on public.motions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS.
--
-- Anyone on the roster can take minutes and record motions — the secretary
-- usually does, not the chair. Authors may correct their own entries; the
-- chair or an admin may correct anyone's.
-- ---------------------------------------------------------------------------

alter table public.meetings enable row level security;
alter table public.agenda_notes enable row level security;
alter table public.motions enable row level security;

drop policy if exists "Members view meetings" on public.meetings;
create policy "Members view meetings"
  on public.meetings for select using (public.is_member());

drop policy if exists "Members view minutes" on public.agenda_notes;
create policy "Members view minutes"
  on public.agenda_notes for select using (public.is_member());

drop policy if exists "Members take minutes" on public.agenda_notes;
create policy "Members take minutes"
  on public.agenda_notes for insert
  with check (public.is_member() and auth.uid() = user_id);

drop policy if exists "Authors and the chair edit minutes" on public.agenda_notes;
create policy "Authors and the chair edit minutes"
  on public.agenda_notes for update
  using (public.can_manage_agenda() or author_id = public.my_member_id())
  with check (public.can_manage_agenda() or author_id = public.my_member_id());

drop policy if exists "Authors and the chair delete minutes" on public.agenda_notes;
create policy "Authors and the chair delete minutes"
  on public.agenda_notes for delete
  using (public.can_manage_agenda() or author_id = public.my_member_id());

drop policy if exists "Members view motions" on public.motions;
create policy "Members view motions"
  on public.motions for select using (public.is_member());

drop policy if exists "Members record motions" on public.motions;
create policy "Members record motions"
  on public.motions for insert
  with check (public.is_member() and auth.uid() = user_id);

drop policy if exists "Recorders and the chair edit motions" on public.motions;
create policy "Recorders and the chair edit motions"
  on public.motions for update
  using (public.can_manage_agenda() or recorded_by = public.my_member_id())
  with check (public.can_manage_agenda() or recorded_by = public.my_member_id());

drop policy if exists "Recorders and the chair delete motions" on public.motions;
create policy "Recorders and the chair delete motions"
  on public.motions for delete
  using (public.can_manage_agenda() or recorded_by = public.my_member_id());

-- Roll-call votes. Whoever is keeping minutes enters these live as the vote
-- is taken, so any member may write them rather than only the chair.
alter table public.motion_votes enable row level security;

drop policy if exists "Members view votes" on public.motion_votes;
create policy "Members view votes"
  on public.motion_votes for select using (public.is_member());

drop policy if exists "Members record votes" on public.motion_votes;
create policy "Members record votes"
  on public.motion_votes for insert
  with check (public.is_member() and auth.uid() = user_id);

drop policy if exists "Members amend votes" on public.motion_votes;
create policy "Members amend votes"
  on public.motion_votes for update
  using (public.is_member()) with check (public.is_member());

drop policy if exists "Members clear votes" on public.motion_votes;
create policy "Members clear votes"
  on public.motion_votes for delete
  using (public.is_member());

do $$
begin
  alter publication supabase_realtime add table public.motion_votes;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.agenda_notes;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.motions;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.meetings;
exception when duplicate_object then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Marking items and meetings complete.
--
-- Ticking an item off is a minute-taking action, so any member may do it —
-- the agenda_items UPDATE policy is chair-only, hence this function.
-- ---------------------------------------------------------------------------

create or replace function public.set_agenda_item_complete(item uuid, complete boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    raise exception 'Only board members can update the agenda';
  end if;

  update public.agenda_items
     set completed_at = case when complete then coalesce(completed_at, now()) else null end
   where id = item and status = 'approved';

  if not found then
    raise exception 'That item is not on the approved agenda';
  end if;
end;
$$;

-- Closing a meeting. Items not reached can either roll forward to the next
-- meeting or be archived as they stand — left unreached they would simply
-- vanish into the archive, which is the wrong default for a board.
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

  insert into public.meetings (meeting_date, status, completed_at, completed_by)
  values (p_meeting_date, 'completed', now(), public.my_member_id())
  on conflict (meeting_date) do update
    set status = 'completed',
        completed_at = now(),
        completed_by = public.my_member_id();

  return carried;
end;
$$;

create or replace function public.reopen_meeting(p_meeting_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_agenda() then
    raise exception 'Only the board chair or an admin can reopen a meeting';
  end if;

  update public.meetings
     set status = 'planning', completed_at = null, completed_by = null
   where meeting_date = p_meeting_date;
end;
$$;

revoke all on function public.set_agenda_item_complete(uuid, boolean) from public;
revoke all on function public.complete_meeting(date, boolean) from public;
revoke all on function public.reopen_meeting(date) from public;
grant execute on function public.set_agenda_item_complete(uuid, boolean) to authenticated;
grant execute on function public.complete_meeting(date, boolean) to authenticated;
grant execute on function public.reopen_meeting(date) to authenticated;
