-- Migration 028: assignees who do not use the app.
--
-- The roster already holds people without an account — the email is optional,
-- and the People page badges them "No login". Concordis is the first entry
-- that is an organisation rather than a person, and adding it exposes two
-- things that were wrong for *any* account-less assignee:
--
--   1. add_member() never set can_vote, and the column defaults to true. So
--      every helper added through the People page quietly became a voting
--      board member and appeared on the meeting roll call.
--
--   2. A shared task ("assigned to everyone") is finished when every active
--      member has settled it. Someone with no login cannot ever tick a box,
--      so one account-less member on the roster would leave every shared task
--      unfinished forever, and recurring shared tasks would never roll over.
--
-- Run in the Supabase SQL Editor after migration 026. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. New people are helpers, not voting board members.
--
-- Same signature as migration 007, so nothing that calls it has to change.
-- Voting is granted afterwards from the People page, which already has the
-- toggle — the safe default is the one that cannot quietly change who votes.
-- ---------------------------------------------------------------------------

create or replace function public.add_member(
  p_name text,
  p_full_name text default null,
  p_email text default null,
  p_role text default null,
  p_bandwidth text default 'limited',
  p_capacity numeric default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  existing_user uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can add people to the roster';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'A name is required';
  end if;

  if exists (select 1 from public.members where lower(name) = lower(btrim(p_name))) then
    raise exception 'Someone with that name is already on the roster';
  end if;

  if p_email is not null and exists (
    select 1 from public.members where lower(email) = lower(btrim(p_email))
  ) then
    raise exception 'That email is already on the roster';
  end if;

  -- If they already signed up, link the account now rather than waiting for
  -- the signup trigger that will never fire again for them.
  if p_email is not null then
    select id into existing_user from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
  end if;

  insert into public.members
    (name, full_name, email, role, bandwidth, daily_capacity_hours,
     user_id, is_active, is_chair, is_admin, can_vote, sort_order)
  values
    (btrim(p_name),
     nullif(btrim(coalesce(p_full_name, '')), ''),
     nullif(btrim(coalesce(p_email, '')), ''),
     nullif(btrim(coalesce(p_role, '')), ''),
     coalesce(p_bandwidth, 'limited'),
     coalesce(p_capacity, 1),
     existing_user,
     true, false, false, false,
     coalesce((select max(sort_order) from public.members), 0) + 1)
  returning id into new_id;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Concordis.
--
-- An organisation, not a person: no email, so no login and no roll call.
-- Capacity is 0 because the Today page's daily-load bar measures how much of
-- a board member's own evening is spoken for, and work handed to an outside
-- partner is not that.
-- ---------------------------------------------------------------------------

insert into public.members
  (name, full_name, email, role, bandwidth, daily_capacity_hours,
   is_active, is_chair, is_admin, can_vote, sort_order)
values
  ('Concordis', 'Concordis Partners', null, 'Outside partner', 'limited', 0,
   true, false, false, false,
   coalesce((select max(sort_order) from public.members), 0) + 1)
on conflict (name) do update set
  role = excluded.role,
  can_vote = false,
  is_active = true;

-- ---------------------------------------------------------------------------
-- 3. "Everyone" means everyone who can open the app.
--
-- Migration 026 counted every active member, which would wait forever on a
-- member who has no way to sign in. The frontend applies the same rule when
-- it draws "3 of 5 done".
-- ---------------------------------------------------------------------------

create or replace function public.completions_recurrence_tick()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  task public.todos;
  active_count integer;
  settled_count integer;
begin
  select * into task from public.todos where id = new.todo_id;
  if not found or not task.assign_to_all or task.repeat_every is null then
    return null;
  end if;

  select count(*) into active_count
    from public.members
   where is_active and email is not null;

  select count(*) into settled_count
    from public.todo_completions c
    join public.members m
      on m.id = c.member_id and m.is_active and m.email is not null
   where c.todo_id = task.id;

  if active_count > 0 and settled_count >= active_count then
    perform public.spawn_recurrence(task);
  end if;
  return null;
end;
$$;
