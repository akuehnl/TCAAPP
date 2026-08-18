-- Migration 005: board meeting agendas.
--
-- Members suggest topics for an upcoming meeting; the board chair decides
-- which are approved and in what order. Meetings are weekly on Tuesdays, so
-- each item is tied to the date of the meeting it belongs to.
--
-- Run in the Supabase SQL Editor after migrations 001-004. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Who chairs the board.
-- ---------------------------------------------------------------------------

alter table public.members add column if not exists is_chair boolean not null default false;

-- Josiah is Board Chair. Kept as a flag rather than reading the free-text
-- `role` so the chair can change hands without a schema edit.
update public.members set is_chair = true  where name = 'Josiah';
update public.members set is_chair = false where name <> 'Josiah';

-- ---------------------------------------------------------------------------
-- 2. Agenda items.
-- ---------------------------------------------------------------------------

create table if not exists public.agenda_items (
  id uuid primary key default gen_random_uuid(),

  meeting_date date not null,              -- the Tuesday this is for
  title text not null,                     -- topic
  description text,
  est_minutes integer not null default 10 check (est_minutes >= 0 and est_minutes <= 480),
  has_motion boolean not null default false,   -- a motion requiring a vote

  status text not null default 'suggested'
    check (status in ('suggested', 'approved', 'declined')),
  sort_order integer,                      -- position on the approved agenda

  submitted_by uuid references public.members (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,

  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agenda_meeting_idx on public.agenda_items (meeting_date, status, sort_order);

drop trigger if exists agenda_set_updated_at on public.agenda_items;
create trigger agenda_set_updated_at
  before update on public.agenda_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Helpers.
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so these can read `members` without tripping its own RLS.
create or replace function public.is_chair()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
     where user_id = auth.uid() and is_active and is_chair
  );
$$;

create or replace function public.my_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.members where user_id = auth.uid() limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS.
--
-- Everyone on the roster reads the whole agenda. Anyone may suggest. Only the
-- chair may approve, decline, reorder, or touch an item once it has left the
-- "suggested" state — enforced here rather than only in the UI, so it holds
-- even if someone calls the API directly.
-- ---------------------------------------------------------------------------

alter table public.agenda_items enable row level security;

drop policy if exists "Members view the agenda" on public.agenda_items;
create policy "Members view the agenda"
  on public.agenda_items for select
  using (public.is_member());

drop policy if exists "Members suggest items" on public.agenda_items;
create policy "Members suggest items"
  on public.agenda_items for insert
  with check (
    public.is_member()
    and auth.uid() = user_id
    -- only the chair may create something already approved
    and (status = 'suggested' or public.is_chair())
  );

drop policy if exists "Chair edits anything, members edit their own suggestions" on public.agenda_items;
create policy "Chair edits anything, members edit their own suggestions"
  on public.agenda_items for update
  using (
    public.is_chair()
    or (submitted_by = public.my_member_id() and status = 'suggested')
  )
  -- the WITH CHECK is what stops a member promoting their own suggestion
  with check (
    public.is_chair()
    or (submitted_by = public.my_member_id() and status = 'suggested')
  );

drop policy if exists "Chair deletes anything, members delete their own suggestions" on public.agenda_items;
create policy "Chair deletes anything, members delete their own suggestions"
  on public.agenda_items for delete
  using (
    public.is_chair()
    or (submitted_by = public.my_member_id() and status = 'suggested')
  );

do $$
begin
  alter publication supabase_realtime add table public.agenda_items;
exception
  when duplicate_object then null;
end;
$$;
