-- Migration 011: attendance lists board members only.
--
-- The roll of names is the five voting board members. Anyone else who attends
-- — staff, a parent, a vendor — is written in as a guest instead. Keeping
-- staff out of the named roll stops the attendance count being read as a
-- quorum count when it is not.
--
-- Run in the Supabase SQL Editor AFTER migration 010. Safe to re-run.

-- Clear rows already recorded against non-voting members. Left in place they
-- would stay hidden in the UI but keep counting toward the header totals.
delete from public.meeting_attendance a
 using public.members m
 where a.member_id = m.id
   and m.can_vote = false;

-- Named attendance is board-only from here on; guests remain free-text.
drop policy if exists "Members record attendance" on public.meeting_attendance;
create policy "Members record attendance"
  on public.meeting_attendance for insert
  with check (
    public.is_member()
    and auth.uid() = user_id
    and (member_id is null or public.member_can_vote(member_id))
  );

drop policy if exists "Members amend attendance" on public.meeting_attendance;
create policy "Members amend attendance"
  on public.meeting_attendance for update
  using (public.is_member())
  with check (
    public.is_member()
    and (member_id is null or public.member_can_vote(member_id))
  );
