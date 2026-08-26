-- Migration 016: app settings (the Zoom link) and deferring an agenda item.
--
-- Run in the Supabase SQL Editor AFTER migration 015. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Settings that belong to the board rather than to a person.
-- ---------------------------------------------------------------------------

create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members (id) on delete set null
);

insert into public.app_settings (key, value)
values ('zoom_url', null)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "Members read settings" on public.app_settings;
create policy "Members read settings"
  on public.app_settings for select using (public.is_member());

-- Only the row seeded above is ever written, so update alone is enough — no
-- insert policy means nobody can invent new setting keys from the browser.
drop policy if exists "Admins change settings" on public.app_settings;
create policy "Admins change settings"
  on public.app_settings for update
  using (public.is_admin()) with check (public.is_admin());

do $$
begin
  alter publication supabase_realtime add table public.app_settings;
exception when duplicate_object then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Deferring an item mid-meeting.
--
-- Moves it to the end of the agenda so the schedule skips past it and the
-- clock moves on. It stays undiscussed, so closing the meeting will offer to
-- carry it to next week like any other unreached item.
--
-- Open to any member for the same reason as marking an item discussed: the
-- secretary is usually the one driving the app while the chair talks.
-- ---------------------------------------------------------------------------

create or replace function public.defer_agenda_item(item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d date;
begin
  if not public.is_member() then
    raise exception 'Only board members can change the agenda';
  end if;

  select meeting_date into d
    from public.agenda_items
   where id = item and status = 'approved';

  if d is null then
    raise exception 'That item is not on the approved agenda';
  end if;

  -- Send it to the back, then renumber the whole list so positions stay
  -- 0..n-1 with no gaps — the same rule the drag-free reordering uses.
  update public.agenda_items
     set sort_order = 1000000
   where id = item;

  with ranked as (
    select id,
           (row_number() over (order by sort_order, inserted_at))::integer - 1 as pos
      from public.agenda_items
     where meeting_date = d and status = 'approved'
  )
  update public.agenda_items a
     set sort_order = r.pos
    from ranked r
   where a.id = r.id and a.sort_order is distinct from r.pos;
end;
$$;

revoke all on function public.defer_agenda_item(uuid) from public;
grant execute on function public.defer_agenda_item(uuid) to authenticated;
