-- Migration 009: voting rights.
--
-- Not everyone on the roster is a voting board member. Elise and Kate were
-- added as staff so they could be assigned tasks and named on agenda items;
-- they take no part in motions. This separates "on the roster" from "votes".
--
-- Run in the Supabase SQL Editor AFTER migration 008. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The flag.
-- ---------------------------------------------------------------------------

alter table public.members add column if not exists can_vote boolean not null default true;

-- The five board members vote; staff do not.
update public.members set can_vote = true
 where name in ('Aden', 'Isaac', 'Josiah', 'Ethan', 'Joe');

update public.members set can_vote = false
 where name in ('Elise', 'Kate');

create or replace function public.member_can_vote(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
     where id = target and is_active and can_vote
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Enforce it on the roll call.
--
-- Hiding non-voters in the UI is not enough — a stray API call could still
-- record a vote for staff, and the minutes would then be wrong in a way
-- nobody would spot.
-- ---------------------------------------------------------------------------

drop policy if exists "Members record votes" on public.motion_votes;
create policy "Members record votes"
  on public.motion_votes for insert
  with check (
    public.is_member()
    and auth.uid() = user_id
    and public.member_can_vote(member_id)
  );

drop policy if exists "Members amend votes" on public.motion_votes;
create policy "Members amend votes"
  on public.motion_votes for update
  using (public.is_member())
  with check (public.is_member() and public.member_can_vote(member_id));

-- Clear any votes already recorded against a non-voter, so a tally cannot be
-- left inflated by rows the rule now forbids.
delete from public.motion_votes v
 using public.members m
 where v.member_id = m.id and not m.can_vote;

-- ---------------------------------------------------------------------------
-- 3. Let an admin change it without another SQL edit.
-- ---------------------------------------------------------------------------

create or replace function public.set_member_voting(target uuid, p_can_vote boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change voting rights';
  end if;

  if not exists (select 1 from public.members where id = target) then
    raise exception 'No such member';
  end if;

  update public.members set can_vote = p_can_vote where id = target;

  -- Removing the right retracts any votes already recorded for them.
  if not p_can_vote then
    delete from public.motion_votes where member_id = target;
  end if;
end;
$$;

revoke all on function public.set_member_voting(uuid, boolean) from public;
grant execute on function public.set_member_voting(uuid, boolean) to authenticated;
