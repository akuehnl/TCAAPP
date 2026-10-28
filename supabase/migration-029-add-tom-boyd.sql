-- Migration 029: add Tom Boyd to the roster.
--
-- A full member, unlike the Concordis entry from 028: he has an email, so he
-- can sign in, he counts toward a shared "Everyone" task, and he appears on
-- the meeting roll call.
--
-- `can_vote` is set true explicitly. Migration 028 made new people non-voting
-- by default on purpose — quietly adding someone to the board's roll call is
-- not something a roster form should do — so being a voting member is stated
-- here rather than inherited.
--
-- He is NOT an admin. Admin can add and remove people and change the chair;
-- "full functionality" reads as "can do what the rest of the board can do",
-- which is everything except that. One toggle on the People page grants it if
-- that was meant.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

insert into public.members
  (name, full_name, email, role, bandwidth, daily_capacity_hours,
   user_id, is_active, is_chair, is_admin, can_vote, sort_order)
values
  ('Tom', 'Tom Boyd', 'tbb5@suddenlink.com', null, 'limited', 1,
   -- Linked now if he has already signed up: the trigger that normally does
   -- this fires when the login is created, and will never fire again for him.
   (select id from auth.users where lower(email) = 'tbb5@suddenlink.com' limit 1),
   true, false, false, true,
   coalesce((select max(sort_order) from public.members), 0) + 1)
on conflict (name) do update set
  full_name = excluded.full_name,
  email     = excluded.email,
  is_active = true,
  can_vote  = true,
  user_id   = coalesce(public.members.user_id, excluded.user_id);

-- No role title invented for him. The People page shows it beside his name
-- and it is used nowhere else, so set it when you know what it should say:
--   update public.members set role = 'Board Oversight' where name = 'Tom';
