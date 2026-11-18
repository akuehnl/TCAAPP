-- One-off repair, not a migration: the 17 Nov 2026 meeting was closed with
-- three approved items still unmarked, so all three carried forward. Two of
-- them had actually been discussed and belong back on the 17th, marked done.
-- Only the calendar item should have moved.
--
-- Run STEP 1 on its own first and read the result. Only run STEP 2 once the
-- titles it is about to move are the two you expect.

-- ===========================================================================
-- STEP 1 — look before touching anything.
--
-- Finds the three items wherever they ended up. Check the titles, and note
-- which meeting_date they are sitting on now.
-- ===========================================================================

select
  meeting_date,
  status,
  sort_order,
  case when completed_at is null then 'NOT discussed' else 'discussed' end as state,
  title
from public.agenda_items
where title ilike '%finance%'
   or title ilike '%closure%'
   or title ilike '%open discussion%'
   or title ilike '%calendar%'
order by meeting_date, sort_order;

-- ===========================================================================
-- STEP 2 — move the two back to 17 Nov and mark them discussed.
--
-- Matched on title rather than on a pasted id, and scoped to items sitting on
-- a date LATER than the 17th, so it can only ever pull something backwards
-- out of a future meeting — never disturb the meeting it is repairing.
--
-- sort_order is recomputed to continue after whatever is already on the 17th,
-- so nothing collides. row_number() cannot appear in UPDATE ... SET, hence the
-- CTE and the join back.
--
-- completed_at is only ever read as a yes/no ("was this discussed?"), but it
-- is set to that evening rather than now() so the archive does not claim the
-- items were discussed a week after the meeting.
-- ===========================================================================

with base as (
  select coalesce(max(sort_order), -1) as last_slot
    from public.agenda_items
   where meeting_date = date '2026-11-17'
     and status = 'approved'
),
moving as (
  select a.id,
         (row_number() over (order by a.sort_order, a.inserted_at))::integer as n
    from public.agenda_items a
   where a.status = 'approved'
     and a.meeting_date > date '2026-11-17'
     and (a.title ilike '%october finance%'
          or a.title ilike '%closure%')
)
update public.agenda_items a
   set meeting_date = date '2026-11-17',
       completed_at = coalesce(a.completed_at, timestamptz '2026-11-18 01:00+00'),
       sort_order   = base.last_slot + moving.n
  from moving, base
 where a.id = moving.id
returning a.title, a.meeting_date, a.sort_order, a.completed_at;

-- ===========================================================================
-- STEP 3 — confirm.
--
-- The 17th should now list all three of its items, the two repaired ones
-- marked discussed. The later meeting should hold the calendar item alone.
-- ===========================================================================

select
  meeting_date,
  sort_order,
  case when completed_at is null then 'NOT discussed' else 'discussed' end as state,
  title
from public.agenda_items
where meeting_date >= date '2026-11-17'
  and status = 'approved'
order by meeting_date, sort_order;
