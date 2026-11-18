-- One-off repair, not a migration: the 17 Nov 2026 meeting was closed with
-- three approved items still unmarked, so all three carried forward. Two of
-- them had been discussed and belong back on the 17th, marked done. Only the
-- calendar item should have moved.
--
-- Paste the whole file into the Supabase SQL Editor and run it once. The
-- editor runs it as a single transaction and shows the last result, so the
-- table you get back is the state afterwards — check it reads the way the
-- comment at the bottom says it should.
--
-- Safe if it has already been run: the second time it finds nothing to move,
-- changes nothing, and returns the same table.

-- ---------------------------------------------------------------------------
-- Move the two back to 17 Nov and mark them discussed.
--
-- Matched on title rather than on ids pasted by hand, and scoped to items
-- sitting on a date LATER than the 17th — so it can only pull items backwards
-- out of a future meeting, and can never disturb the meeting it is repairing.
--
-- sort_order continues after whatever is already on the 17th, so nothing
-- collides. row_number() cannot appear in UPDATE ... SET, hence the CTE and
-- the join back to it.
--
-- completed_at is only ever read as a yes/no ("was this discussed?"), but it
-- is set to that evening rather than now() so the archive does not claim the
-- items were discussed a week after the meeting happened.
-- ---------------------------------------------------------------------------

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
 where a.id = moving.id;

-- ---------------------------------------------------------------------------
-- What you should see below:
--
--   2026-11-17 ... discussed     October finance review
--   2026-11-17 ... discussed     Closure to open discussions
--   2026-11-17 ... (as it was)   ...anything else already on the 17th
--   2026-11-24 ... NOT discussed Calendar solidification        <- alone
--
-- If the two are still on the later date, their titles do not contain
-- "october finance" or "closure" — send me the real titles and I will adjust
-- the two patterns above.
-- ---------------------------------------------------------------------------

select
  meeting_date,
  sort_order,
  case when completed_at is null then 'NOT discussed' else 'discussed' end as state,
  title
from public.agenda_items
where meeting_date >= date '2026-11-17'
  and status = 'approved'
order by meeting_date, sort_order;
