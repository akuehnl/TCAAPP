-- Migration 006: admin role, plus changing the board chair from the app.
--
-- Adds an admin flag (Aden) that carries every chair power and can manage the
-- roster. The chair is now switched in the People section rather than by
-- editing SQL, and because permissions are derived from the members table at
-- query time, a chair change takes effect immediately for everyone.
--
-- Run in the Supabase SQL Editor after migrations 001-005. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Admin flag.
-- ---------------------------------------------------------------------------

alter table public.members add column if not exists is_admin boolean not null default false;

update public.members set is_admin = true where name = 'Aden';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
     where user_id = auth.uid() and is_active and is_admin
  );
$$;

-- Anything the chair may do, an admin may also do.
create or replace function public.can_manage_agenda()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_chair() or public.is_admin();
$$;

-- ---------------------------------------------------------------------------
-- 2. Agenda policies now recognise admins.
-- ---------------------------------------------------------------------------

drop policy if exists "Members suggest items" on public.agenda_items;
create policy "Members suggest items"
  on public.agenda_items for insert
  with check (
    public.is_member()
    and auth.uid() = user_id
    and (status = 'suggested' or public.can_manage_agenda())
  );

drop policy if exists "Chair edits anything, members edit their own suggestions" on public.agenda_items;
drop policy if exists "Chair or admin edits anything, members edit their own suggestions" on public.agenda_items;
create policy "Chair or admin edits anything, members edit their own suggestions"
  on public.agenda_items for update
  using (
    public.can_manage_agenda()
    or (submitted_by = public.my_member_id() and status = 'suggested')
  )
  -- WITH CHECK is what stops a member promoting their own suggestion.
  with check (
    public.can_manage_agenda()
    or (submitted_by = public.my_member_id() and status = 'suggested')
  );

drop policy if exists "Chair deletes anything, members delete their own suggestions" on public.agenda_items;
drop policy if exists "Chair or admin deletes anything, members delete their own suggestions" on public.agenda_items;
create policy "Chair or admin deletes anything, members delete their own suggestions"
  on public.agenda_items for delete
  using (
    public.can_manage_agenda()
    or (submitted_by = public.my_member_id() and status = 'suggested')
  );

-- ---------------------------------------------------------------------------
-- 3. Roster management.
--
-- Done through functions rather than a bare UPDATE policy so the invariants
-- hold in one place: exactly one chair, and nobody can lock themselves out.
-- ---------------------------------------------------------------------------

create or replace function public.set_board_chair(new_chair uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change the board chair';
  end if;

  if not exists (select 1 from public.members where id = new_chair and is_active) then
    raise exception 'That person is not an active member';
  end if;

  -- One statement, so there is never a moment with two chairs or none.
  update public.members set is_chair = (id = new_chair);
end;
$$;

create or replace function public.set_member_active(target uuid, active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can activate or deactivate members';
  end if;

  if target = public.my_member_id() and not active then
    raise exception 'You cannot deactivate your own account';
  end if;

  if not active and exists (select 1 from public.members where id = target and is_chair) then
    raise exception 'Assign a new board chair before deactivating the current one';
  end if;

  update public.members set is_active = active where id = target;
end;
$$;

revoke all on function public.set_board_chair(uuid) from public;
revoke all on function public.set_member_active(uuid, boolean) from public;
grant execute on function public.set_board_chair(uuid) to authenticated;
grant execute on function public.set_member_active(uuid, boolean) to authenticated;

-- Admins may also edit roster details directly (role, capacity, email).
-- is_admin and is_chair are deliberately excluded — see the trigger below.
drop policy if exists "Admins update the roster" on public.members;
create policy "Admins update the roster"
  on public.members for update
  using (public.is_admin())
  with check (public.is_admin());

-- Keep is_chair and is_admin changes to the functions above, so the
-- single-chair rule cannot be bypassed by a direct table update.
create or replace function public.guard_member_flags()
returns trigger
language plpgsql
as $$
begin
  if new.is_chair is distinct from old.is_chair
     or new.is_admin is distinct from old.is_admin then
    -- session_replication_role is not set for normal clients; the SECURITY
    -- DEFINER functions above set this flag to mark a legitimate change.
    if current_setting('app.flag_change_ok', true) is distinct from 'on' then
      raise exception 'Change chair or admin status through set_board_chair()';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists members_guard_flags on public.members;
create trigger members_guard_flags
  before update on public.members
  for each row execute function public.guard_member_flags();

-- Re-declare set_board_chair now that the guard exists, so it can mark itself.
create or replace function public.set_board_chair(new_chair uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change the board chair';
  end if;

  if not exists (select 1 from public.members where id = new_chair and is_active) then
    raise exception 'That person is not an active member';
  end if;

  perform set_config('app.flag_change_ok', 'on', true);
  update public.members set is_chair = (id = new_chair);
  perform set_config('app.flag_change_ok', 'off', true);
end;
$$;
