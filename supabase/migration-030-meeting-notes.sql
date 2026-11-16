-- Migration 030: free-form notes attached to a meeting.
--
-- Separate from `agenda_notes`, which hang off a single agenda item and are
-- taken live during discussion. These hang off the meeting itself: an AI
-- summary pasted in afterwards, a write-up, follow-ups that span the whole
-- evening. Several per meeting, each with its own label.
--
-- `meeting_date` is deliberately NOT a foreign key to `meetings`. A meeting
-- only gets a row there once it is started or closed, and notes must be
-- droppable onto any date, including one the board never formally opened.
-- `agenda_items` keys off the date the same way for the same reason.
--
-- Run in the Supabase SQL Editor after migration 025. Safe to re-run.

create table if not exists public.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null,

  -- "AI summary", "Aden's follow-ups". Optional: an unlabelled entry is just
  -- "Notes".
  label text,
  body text not null,

  author_id uuid references public.members (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_notes_date_idx
  on public.meeting_notes (meeting_date, inserted_at);

drop trigger if exists meeting_notes_set_updated_at on public.meeting_notes;
create trigger meeting_notes_set_updated_at
  before update on public.meeting_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: the same rule as minutes. Anyone on the roster can add, authors fix
-- their own, the chair or an admin fixes anyone's.
--
-- Note there is no "meeting is closed" condition anywhere here. Dropping a
-- summary onto a meeting that finished a fortnight ago is the point of the
-- table, so a closed meeting is not read-only for these the way its agenda is.
-- ---------------------------------------------------------------------------

alter table public.meeting_notes enable row level security;

drop policy if exists "Members view meeting notes" on public.meeting_notes;
create policy "Members view meeting notes"
  on public.meeting_notes for select using (public.is_member());

drop policy if exists "Members add meeting notes" on public.meeting_notes;
create policy "Members add meeting notes"
  on public.meeting_notes for insert
  with check (public.is_member() and auth.uid() = user_id);

drop policy if exists "Authors and the chair edit meeting notes" on public.meeting_notes;
create policy "Authors and the chair edit meeting notes"
  on public.meeting_notes for update
  using (public.can_manage_agenda() or author_id = public.my_member_id())
  with check (public.can_manage_agenda() or author_id = public.my_member_id());

drop policy if exists "Authors and the chair delete meeting notes" on public.meeting_notes;
create policy "Authors and the chair delete meeting notes"
  on public.meeting_notes for delete
  using (public.can_manage_agenda() or author_id = public.my_member_id());

-- ---------------------------------------------------------------------------
-- Moving a meeting has to bring these with it.
--
-- Same function as migration 025 with one more table in it: a meeting's date
-- is its identity across every table that keys off it, and a summary left
-- behind on the old date would be orphaned on a day with no meeting.
-- ---------------------------------------------------------------------------

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

  if exists (select 1 from public.agenda_items where meeting_date = p_to)
     or exists (select 1 from public.meetings where meeting_date = p_to) then
    raise exception 'There is already a meeting on %. Move or clear that one first.', p_to;
  end if;

  update public.agenda_items      set meeting_date = p_to where meeting_date = p_from;
  update public.meeting_attendance set meeting_date = p_to where meeting_date = p_from;
  update public.meeting_notes     set meeting_date = p_to where meeting_date = p_from;
  update public.meetings          set meeting_date = p_to where meeting_date = p_from;
end;
$$;
