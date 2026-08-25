-- Seed 003: personnel absences.
--
-- Run in the Supabase SQL Editor after migration 014. Re-runnable: skipped if
-- an event with the same title and start date already exists.

with creator as (
  select id from auth.users where lower(email) = 'adenkuehnl@gmail.com' limit 1
),
incoming (title, starts_on, ends_on, category, description) as (
  values
    ('Cassie Salter OOO'::text,   '2026-08-31'::date, '2026-09-17'::date, 'personnel'::text,
     'Overlaps the first two weeks of term and the Sept 8-10 discipline walk-through.'::text),
    ('Joe/Linda Martinez OOO',    '2026-09-22',       '2026-10-02',       'personnel',
     'Overlaps the Sept 22-24 week 3 walk-through and the Oct 1 soft evaluation.')
)
insert into public.calendar_events
  (user_id, created_by, title, starts_on, ends_on, category, description)
select
  c.id,
  (select id from public.members where name = 'Aden'),
  i.title, i.starts_on, i.ends_on, i.category, i.description
from incoming i
cross join creator c
where not exists (
  select 1 from public.calendar_events e
   where e.title = i.title and e.starts_on = i.starts_on
);
