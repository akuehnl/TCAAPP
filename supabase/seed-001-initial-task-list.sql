-- Seed 001: the board's existing task list.
--
-- Run in the Supabase SQL Editor after migrations 001-003. Re-runnable: it
-- skips any task whose title is already present, so running it twice will not
-- duplicate anything.
--
-- Assumptions baked in (see the corrections section at the bottom):
--   * "Yes" in the source list -> is_complete = true
--   * "RED" in the source list -> priority = 'high'; everything else 'medium'
--   * "All" / "ALL"            -> left unassigned, noted in the task notes
--   * Completed items get no estimates.

-- ---------------------------------------------------------------------------
-- 1. Two assignees who are not board members.
-- ---------------------------------------------------------------------------

insert into public.members (name, full_name, email, role, bandwidth, notes, sort_order) values
  ('Elise', null,        null, 'Staff - events & curriculum', 'high',
   'Added from the shared task list. No email on file yet, so cannot sign in.', 6),
  ('Kate',  'Kate Rand', null, 'Marketing',                   'limited',
   'Added from the shared task list. No email on file yet, so cannot sign in.', 7)
on conflict (name) do nothing;

-- Give them a daily capacity if migration-003 has been run.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'members'
      and column_name = 'daily_capacity_hours'
  ) then
    update public.members set daily_capacity_hours = 2 where name = 'Elise';
    update public.members set daily_capacity_hours = 1 where name = 'Kate';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The task list.
-- ---------------------------------------------------------------------------

with creator as (
  select id from auth.users where lower(email) = 'adenkuehnl@gmail.com' limit 1
),
incoming (title, who, due_date, priority, is_complete, work_hours, cal_days, label, notes) as (
  values
    ('Planning of Opening Ceremony'::text, 'Elise'::text, '2026-08-22'::date, 'medium'::text, false, 6::numeric, 21::numeric, 'Events'::text, 'Date still TBD: 9/25 or 10/2. Source list asked "what is this?"'::text),
    ('Swag Development, ordering', 'Kate', '2026-08-05', 'medium', false, 4, 21, 'Marketing', 'Kate Rand. TCA marketing; needs sizes.'),
    ('Supply List (Family, faculty, school)', 'Isaac', '2026-08-22', 'medium', true, null, null, null, 'Send out with 4 week email'),
    ('School bible verses/quotes determined for walls', 'Josiah', '2026-05-10', 'medium', false, 3, 14, null, 'Motto, Bible Verse'),
    ('Create Safety Drill Schedule', 'Aden', '2026-08-25', 'medium', false, 3, 7, null, null),
    ('Transfer and close out ACCU Bank', 'Aden', '2026-08-25', 'medium', true, null, null, 'Finance', null),
    ('Teacher Contracts', 'Josiah', '2026-05-25', 'medium', true, null, null, 'Operation', null),
    ('Telos Planning', 'Elise', '2026-05-25', 'medium', true, null, null, 'Operation', 'Set up under school billing'),
    ('Newsletter', 'Josiah', '2026-05-27', 'high', true, null, null, null, 'NECESSARY'),
    ('Pickup and Drop off procedures and map, including parking', 'Isaac', '2026-05-30', 'medium', true, null, null, null, null),
    ('Scripture memory for year', null, '2026-08-30', 'medium', false, 4, 14, null, 'Whole board. With teachers - Humanities Curriculum'),
    ('Communication protocols drafted', 'Isaac', '2026-08-23', 'high', false, 4, 10, null, null),
    ('Student assessments scheduled', 'Josiah', '2026-06-18', 'medium', true, null, null, null, null),
    ('Order Paint', 'Josiah', '2026-06-27', 'high', true, null, null, 'Operation', null),
    ('Order classroom Nametags', 'Elise', '2026-08-18', 'high', false, 1.5, 10, null, null),
    ('Daily, weekly, monthly maintenance schedule', 'Joe', '2026-08-20', 'medium', false, 3, 7, null, null),
    ('Order Remaining Curriculum', 'Elise', '2026-07-15', 'high', true, null, null, null, null),
    ('Paint Walls', null, '2026-07-23', 'medium', true, null, null, 'Operation', 'Whole board. Mr. Boyd, Mr. Boyd'),
    ('Finalize Class Rooms', 'Ethan', '2026-08-10', 'medium', true, null, null, 'Organization', 'Propose which classroom for which class after cohort assessments'),
    ('Security Cameras installed', 'Ethan', '2026-08-20', 'medium', false, 2, 30, 'Operation', null),
    ('Finalize Inservice schedule, agenda and responsibilities', 'Josiah', '2026-08-18', 'high', false, 5, 10, null, null),
    ('Security protocols established', 'Ethan', '2026-08-20', 'medium', false, 4, 14, null, null),
    ('Etiquette documents established', 'Ethan', '2026-08-20', 'medium', false, 4, 14, null, 'Faculty Handbook'),
    ('Howell Melon Fest Run', 'Aden', '2026-08-15', 'medium', true, null, null, 'Marketing', null),
    ('Ice Cream Social', 'Elise', '2026-09-04', 'medium', false, 6, 21, null, null),
    ('Faculty Handbook', 'Isaac', '2026-08-20', 'medium', false, 10, 21, 'Operation', null),
    ('Finalize Class Room Furniture Needs', 'Joe', '2026-08-17', 'medium', false, 3, 7, 'Operation', 'And Elise and Angie'),
    ('Furniture Placement', null, '2026-08-17', 'medium', false, 6, 3, 'Operation', 'Whole board.'),
    ('Electronics Setup', 'Aden', '2026-08-19', 'medium', false, 5, 7, 'Operation', 'Run point and delegate as needed'),
    ('Wifi Set up', 'Ethan', '2026-08-19', 'medium', true, null, null, 'Operation', '123 - NET -- 3 year quote'),
    ('Teacher Training - core training done by this date', 'Josiah', '2026-08-21', 'medium', false, 8, 14, 'Operation', null),
    ('Student Assessments distributed to parents', 'Isaac', '2026-08-24', 'medium', true, null, null, null, null),
    ('Establish teacher/faculty assessment schedule and process', 'Aden', '2026-08-25', 'medium', false, 4, 14, null, 'Email Heather regarding Faculty Handbook'),
    ('Interior signage installed', 'Kate', '2026-08-28', 'medium', false, 2, 21, null, null),
    ('Large Outside Signage installed', 'Ethan', '2026-08-28', 'medium', false, 2, 30, null, 'Low wall outside playground'),
    ('Talking Points for the Ice Cream Social', null, '2026-09-01', 'medium', false, 2, 7, null, 'Whole board. Elise can help create a suggested list'),
    ('Substitute topics and lessons', null, '2026-09-08', 'medium', false, 4, 14, null, 'Whole board.'),
    ('Start planning "Quarterly Parent Academies"', 'Josiah', '2026-10-15', 'medium', false, 4, 30, 'Organization', 'Rec per Josh Boyd: 6 per year. Someone speaks to the mission; the board gives the community an update.'),
    ('Yearly Review of Board members (From Board Book)', null, '2026-08-05', 'medium', false, 3, 21, 'Organization', 'Whole board. Source list noted January/February.'),
    ('Legacy Event Planning', 'Elise', '2027-01-01', 'medium', false, 8, 45, 'Organization', null),
    ('Begin marketing January 1st', 'Aden', '2027-01-01', 'medium', false, 6, 30, null, null),
    ('Send out Giving statements to donors direct to TCA', 'Aden', '2027-01-05', 'medium', false, 3, 10, 'Finance', null),
    ('Teachers Aid sign up process created', 'Isaac', '2027-02-01', 'medium', true, null, null, null, null),
    ('Annual Impact Report (Donor Promised)', 'Elise', '2027-06-15', 'medium', false, 10, 45, null, 'Donor promised. Source list asked "what is this?"'),
    ('Order school supplies', 'Aden', null, 'medium', false, 2, 14, null, 'No due date on the source list.'),
    ('Medication Administration List', 'Josiah', null, 'medium', false, 2, 7, null, 'No due date on the source list.')
)
insert into public.todos
  (user_id, title, assignee_id, due_date, priority, is_complete,
   est_work_hours, est_calendar_days, project_label, notes)
select
  c.id, i.title, m.id, i.due_date, i.priority, i.is_complete,
  i.work_hours, i.cal_days, i.label, i.notes
from incoming i
cross join creator c
left join public.members m on lower(m.name) = lower(i.who)
where not exists (select 1 from public.todos t where t.title = i.title);

-- ---------------------------------------------------------------------------
-- 3. Corrections, if the assumptions above were wrong.
-- ---------------------------------------------------------------------------

-- "Yes" did NOT mean completed:
--   update public.todos set is_complete = false;

-- "RED" meant at-risk rather than high priority. The six RED rows are:
--   Newsletter, Communication protocols drafted, Order Paint,
--   Order classroom Nametags, Order Remaining Curriculum,
--   Finalize Inservice schedule/agenda/responsibilities

-- Give the six "whole board" tasks a single owner:
--   update public.todos
--      set assignee_id = (select id from public.members where name = 'Isaac')
--    where notes like 'Whole board%';

-- Let Elise and Kate sign in once you have their addresses:
--   update public.members set email = 'elise@example.com' where name = 'Elise';
--   update public.members set email = 'kate@example.com'  where name = 'Kate';
