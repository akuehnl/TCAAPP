-- Migration 007: grant/revoke admin, and add people from the app.
--
-- Also fixes an over-lock from migration 006: the guard trigger blocked every
-- change to is_admin, including from the SQL editor, leaving no supported way
-- to make anyone else an admin. Admin changes now go through
-- set_member_admin(), which the trigger recognises.
--
-- Run in the Supabase SQL Editor after migration 006. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Grant / revoke admin.
-- ---------------------------------------------------------------------------

create or replace function public.set_member_admin(target uuid, admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change admin status';
  end if;

  if not exists (select 1 from public.members where id = target) then
    raise exception 'No such member';
  end if;

  if not admin then
    -- Count admins that would be left. Without this the board can lock
    -- itself out of roster management entirely, with no way back short of
    -- direct database access.
    select count(*) into remaining
      from public.members
     where is_admin and is_active and id <> target;

    if remaining = 0 then
      raise exception 'The board must keep at least one active admin';
    end if;
  end if;

  if admin and not exists (select 1 from public.members where id = target and is_active) then
    raise exception 'Reactivate this member before making them an admin';
  end if;

  perform set_config('app.flag_change_ok', 'on', true);
  update public.members set is_admin = admin where id = target;
  perform set_config('app.flag_change_ok', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Add someone to the roster.
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
     user_id, is_active, is_chair, is_admin, sort_order)
  values
    (btrim(p_name),
     nullif(btrim(coalesce(p_full_name, '')), ''),
     nullif(btrim(coalesce(p_email, '')), ''),
     nullif(btrim(coalesce(p_role, '')), ''),
     coalesce(p_bandwidth, 'limited'),
     coalesce(p_capacity, 1),
     existing_user,
     true, false, false,
     coalesce((select max(sort_order) from public.members), 0) + 1)
  returning id into new_id;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Teach the guard trigger about set_member_admin().
-- ---------------------------------------------------------------------------

create or replace function public.guard_member_flags()
returns trigger
language plpgsql
as $$
begin
  if new.is_chair is distinct from old.is_chair
     or new.is_admin is distinct from old.is_admin then
    -- set_board_chair() and set_member_admin() set this flag to mark a
    -- change that has already passed their guards.
    if current_setting('app.flag_change_ok', true) is distinct from 'on' then
      raise exception
        'Change chair or admin status through set_board_chair() or set_member_admin()';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.set_member_admin(uuid, boolean) from public;
revoke all on function public.add_member(text, text, text, text, text, numeric) from public;
grant execute on function public.set_member_admin(uuid, boolean) to authenticated;
grant execute on function public.add_member(text, text, text, text, text, numeric) to authenticated;

-- Escape hatch, should you ever need to change these flags directly in the
-- SQL editor (run both statements together in one query):
--   select set_config('app.flag_change_ok', 'on', true);
--   update public.members set is_admin = true where name = 'Someone';
