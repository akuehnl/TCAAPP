-- Seed 002: the 2026-27 school calendar and observation schedule.
--
-- Transcribed from the printed TCA calendar (20260821 calendar.pdf) and
-- TCA_Observation_Schedule_2026-27.docx. 46 events.
--
-- Run in the Supabase SQL Editor after migration 013. Re-runnable: an event is
-- skipped if one with the same title and start date already exists, so a
-- second run adds nothing. Note that keying on title alone would collapse the
-- five separate Fire Drills into one.

with creator as (
  select id from auth.users where lower(email) = 'adenkuehnl@gmail.com' limit 1
),
incoming (title, starts_on, ends_on, category, description) as (
  values
    -- ---- School calendar: single days -------------------------------------
    ('Independence Day'::text,        '2026-07-04'::date, null::date, 'holiday'::text,        null::text),
    ('Back to School Night',          '2026-09-03', null, 'milestone',      null),
    ('Labor Day',                     '2026-09-07', null, 'holiday',        null),
    ('School Starts',                 '2026-09-08', null, 'milestone',      'First day of the 2026-27 school year.'),
    ('Fire Drill',                    '2026-09-15', null, 'fire-drill',     null),
    ('Fire Drill',                    '2026-10-07', null, 'fire-drill',     null),
    ('Columbus Day',                  '2026-10-12', null, 'holiday',        null),
    ('Lockdown Drill',                '2026-10-22', null, 'lockdown-drill', null),
    ('Parent Partnership',            '2026-10-23', null, 'partnership',    null),
    ('Fire Drill',                    '2026-11-10', null, 'fire-drill',     null),
    ('Tornado Drill',                 '2026-11-18', null, 'tornado-drill',  null),
    ('New Year''s Day',               '2027-01-01', null, 'holiday',        null),
    ('Martin Luther King Jr Day',     '2027-01-18', null, 'holiday',        null),
    ('Lockdown Drill',                '2027-01-21', null, 'lockdown-drill', null),
    ('Fire Drill',                    '2027-02-10', null, 'fire-drill',     null),
    ('President''s Day',              '2027-02-15', null, 'holiday',        null),
    ('Tornado Drill',                 '2027-03-16', null, 'tornado-drill',  null),
    ('Good Friday',                   '2027-03-26', null, 'holiday',        null),
    ('Easter',                        '2027-03-28', null, 'holiday',        null),
    ('Easter Monday',                 '2027-03-29', null, 'holiday',        null),
    ('Parent Partnership',            '2027-04-02', null, 'partnership',    null),
    ('Lockdown Drill',                '2027-04-14', null, 'lockdown-drill', null),
    ('Fire Drill',                    '2027-05-13', null, 'fire-drill',     null),
    ('Last Day of School',            '2027-05-27', null, 'milestone',      null),
    ('Memorial Day',                  '2027-05-31', null, 'holiday',        null),

    -- ---- School calendar: multi-day ---------------------------------------
    ('Thanksgiving Break',            '2026-11-23', '2026-11-27', 'break',     null),
    ('Finals',                        '2026-12-15', '2026-12-17', 'milestone', 'First semester finals.'),
    ('Christmas Break',               '2026-12-21', '2027-01-01', 'break',     null),
    ('Easter Break',                  '2027-03-22', '2027-03-26', 'break',     null),
    ('Finals',                        '2027-05-25', '2027-05-27', 'milestone', 'Second semester finals.'),

    -- ---- Observation schedule: fall 2026 ----------------------------------
    ('Discipline walk-through',       '2026-09-08', '2026-09-10', 'observation',
     'Touchpoint 1. All four teachers, brief visit each. Checking how routines, expectations and transitions are forming.'),
    ('Week 3 walk-through',           '2026-09-22', '2026-09-24', 'observation',
     'Touchpoint 2. All four teachers, 15 minutes minimum each.'),
    ('Soft evaluation (video) - Angie B. & Elise W.', '2026-09-29', null, 'observation',
     'Touchpoint 3. Recorded session; a board member attends the full period in person. File to Concordis within two school days.'),
    ('Soft evaluation (video) - Bonnie W.',           '2026-09-30', null, 'observation',
     'Touchpoint 3. Recorded session; a board member attends the full period in person.'),
    ('Soft evaluation (video) - Cassie S.',           '2026-10-01', null, 'observation',
     'Touchpoint 3. Recorded session; a board member attends the full period in person.'),
    ('Formal evaluation (video) - Angie B. & Elise W.', '2026-10-27', null, 'observation',
     'Touchpoint 4. The formal evaluation lesson. Confirm video consent is current before recording.'),
    ('Formal evaluation (video) - Bonnie W.',           '2026-10-28', null, 'observation',
     'Touchpoint 4. The formal evaluation lesson.'),
    ('Formal evaluation (video) - Cassie S.',           '2026-10-29', null, 'observation',
     'Touchpoint 4. The formal evaluation lesson.'),

    -- ---- Observation schedule: spring 2027 --------------------------------
    ('Discipline walk-through',       '2027-01-05', '2027-01-07', 'observation',
     'Touchpoint 1. All four teachers, brief visit each.'),
    ('Week 3 walk-through',           '2027-01-19', '2027-01-20', 'observation',
     'Touchpoint 2. All four teachers, 15 minutes minimum each. Jan 21 avoided for the lockdown drill.'),
    ('Soft evaluation (video) - Angie B. & Elise W.', '2027-03-09', null, 'observation',
     'Touchpoint 3. Recorded session; a board member attends the full period in person.'),
    ('Soft evaluation (video) - Bonnie W.',           '2027-03-10', null, 'observation',
     'Touchpoint 3. Recorded session; a board member attends the full period in person.'),
    ('Soft evaluation (video) - Cassie S.',           '2027-03-11', null, 'observation',
     'Touchpoint 3. Recorded session; a board member attends the full period in person.'),
    ('Formal evaluation (video) - Angie B. & Elise W.', '2027-04-20', null, 'observation',
     'Touchpoint 4. Timed so Concordis feedback and coaching land before finals on May 25-27.'),
    ('Formal evaluation (video) - Bonnie W.',           '2027-04-21', null, 'observation',
     'Touchpoint 4. The formal evaluation lesson.'),
    ('Formal evaluation (video) - Cassie S.',           '2027-04-22', null, 'observation',
     'Touchpoint 4. The formal evaluation lesson.')
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
