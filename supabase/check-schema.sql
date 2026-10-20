-- Schema check: what this database actually has against what the app expects.
--
-- Not a migration — it changes nothing. Run it in the Supabase SQL Editor any
-- time, and especially after a migration errors: a missing column usually
-- means an earlier migration was skipped, and a plpgsql function will happily
-- be created referencing a column that does not exist, so the gap can sit
-- unnoticed until something inserts a row.
--
-- Anything listed as MISSING names the migration that adds it. Run that one,
-- then run this again.

with expected(migration, kind, name, detail) as (values
  -- Tables
  ('schema.sql', 'table',  'todos',              ''),
  ('002',        'table',  'members',            ''),
  ('005',        'table',  'agenda_items',       ''),
  ('008',        'table',  'meetings',           ''),
  ('008',        'table',  'agenda_notes',       ''),
  ('008',        'table',  'motions',            ''),
  ('008',        'table',  'motion_votes',       ''),
  ('010',        'table',  'meeting_attendance', ''),
  ('013',        'table',  'calendar_events',    ''),
  ('016',        'table',  'app_settings',       ''),
  ('023',        'table',  'todo_completions',   ''),

  -- Columns that later migrations and the app depend on
  ('001', 'column', 'todos',            'due_date'),
  ('001', 'column', 'todos',            'est_work_hours'),
  ('001', 'column', 'todos',            'est_calendar_days'),
  ('002', 'column', 'todos',            'assignee_id'),
  ('003', 'column', 'members',          'daily_capacity_hours'),
  ('004', 'column', 'todos',            'completed_at'),
  ('005', 'column', 'members',          'is_chair'),
  ('006', 'column', 'members',          'is_admin'),
  ('008', 'column', 'agenda_items',     'completed_at'),
  ('009', 'column', 'members',          'can_vote'),
  ('012', 'column', 'members',          'last_seen_at'),
  ('015', 'column', 'meetings',         'started_at'),
  ('023', 'column', 'todos',            'assign_to_all'),
  ('024', 'column', 'todo_completions', 'state'),
  ('026', 'column', 'todos',            'repeat_every'),
  ('026', 'column', 'todos',            'repeat_unit'),
  ('026', 'column', 'todos',            'repeat_parent_id'),

  -- Functions
  ('002', 'function', 'is_member',                   ''),
  ('002', 'function', 'my_member_id',                ''),
  ('006', 'function', 'is_admin',                    ''),
  ('006', 'function', 'can_manage_agenda',           ''),
  ('006', 'function', 'set_board_chair',             ''),
  ('007', 'function', 'add_member',                  ''),
  ('007', 'function', 'set_member_admin',            ''),
  ('009', 'function', 'member_can_vote',             ''),
  ('009', 'function', 'set_member_voting',           ''),
  ('008', 'function', 'set_agenda_item_complete',    ''),
  ('008', 'function', 'complete_meeting',            ''),
  ('008', 'function', 'reopen_meeting',              ''),
  ('015', 'function', 'start_meeting',               ''),
  ('015', 'function', 'clear_meeting_start',         ''),
  ('016', 'function', 'defer_agenda_item',           ''),
  ('021', 'function', 'next_meeting_on_or_after',    ''),
  ('025', 'function', 'reschedule_meeting',          ''),
  ('026', 'function', 'spawn_recurrence',            ''),
  ('026', 'function', 'todos_recurrence_tick',       ''),
  ('026', 'function', 'completions_recurrence_tick', ''),
  ('027', 'function', 'set_agenda_order',            ''),

  -- Triggers
  ('026', 'trigger', 'todos_spawn_recurrence',       ''),
  ('026', 'trigger', 'completions_spawn_recurrence', ''),

  -- Rows the app expects to find
  ('028', 'row', 'members', 'Concordis')
)
select
  case
    when e.kind = 'table'  and to_regclass('public.' || e.name) is not null then 'ok'
    when e.kind = 'column' and exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = e.name and c.column_name = e.detail
    ) then 'ok'
    when e.kind = 'function' and exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = e.name
    ) then 'ok'
    when e.kind = 'trigger' and exists (
      select 1 from pg_trigger t where not t.tgisinternal and t.tgname = e.name
    ) then 'ok'
    when e.kind = 'row' and e.name = 'members' and exists (
      select 1 from public.members where name = e.detail
    ) then 'ok'
    else 'MISSING'
  end                                                              as status,
  e.migration                                                      as added_by_migration,
  e.kind,
  case when e.detail = '' then e.name else e.name || '.' || e.detail end as object
from expected e
-- 'MISSING' sorts before 'ok', so anything to fix is at the top.
order by status, e.migration, e.kind, object;
