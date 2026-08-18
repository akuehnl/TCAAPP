# TCA Tasks

A shared task board for the Tyndale Classical Academy board. Static frontend
(HTML/CSS/JS, no build step) backed by [Supabase](https://supabase.com)
(Postgres + Auth), hosted free on GitHub Pages.

Live at **https://akuehnl.github.io/TCAAPP/**

## Views

| View | Shows |
| --- | --- |
| **Today** | Daily overview — every member's work for today on one page, overdue rolled in, with checkboxes to mark done |
| **Shared board** | Every task, with an Assignee filter (Anyone / Unassigned / any member) |
| **My tasks** | Only open tasks assigned to the signed-in member |
| **Archive** | Completed tasks, grouped by the month they were finished |

Tab labels carry live counts. **Completed tasks leave the active board
entirely** and move to the Archive, so Shared board and My tasks only ever show
open work. Unchecking a task in the Archive returns it to the board. The list
views sort by soonest due date (undated last), then priority; overdue tasks are
outlined in red.

## How the Today page decides what's due

`est_calendar_days` is treated as **lead time**, not effort — how long the task
takes in wall-clock terms once you account for waiting on other people.
Subtracting it from the due date gives the date work has to be underway by:

```
start_by   = due_date − est_calendar_days
daily_load = est_work_hours ÷ est_calendar_days
```

A task lands on the Today page when `today ≥ start_by`, which is a different
question from "what's due soon". Ordering security cameras due Sep 20 with a
35-day lead time is already late on Aug 17; a budget task due Aug 28 with a
3-day lead time isn't due to start until Aug 25.

Each member's `daily_load` is summed across their overdue and in-flight tasks
and compared against `daily_capacity_hours` from the roster (seeded at 3h/day
for high-bandwidth members, 1h/day for limited). Going over turns the bar red.

Tasks with no due date can't produce a `start_by`, so they appear in a separate
"No due date" bucket rather than disappearing, and don't count toward load.

## Board roster

The five members are seeded in the database, so they can be assigned tasks
whether or not they've created a login yet.

| Name | Role | Bandwidth |
| --- | --- | --- |
| Aden Kuehnl | Treasurer | High — also handles marketing |
| Isaac Boyd | Board Oversight | High — business/legal, led lease negotiation, organizes tasks |
| Josiah Warner | Board Chair | Limited — decision-making, culture, enrollment, hiring |
| Ethan Nelson | Secretary | Limited — vendor contracts (signage, security cameras) |
| Joe Martinez | Board Oversight | Limited — retired; errands, supply runs, church outreach, theology |
| Elise | Staff — events & curriculum | High — no email on file yet |
| Kate Rand | Marketing | Limited — no email on file yet |

An account is linked to its roster row automatically at signup by matching
email address. **Signing up with an address that isn't on the roster gets you
a "Not on the roster" screen and no data** — that's the access control. To add
someone, insert a row into `members` in the Supabase SQL editor.

## Task fields

| Field | Column | Notes |
| --- | --- | --- |
| Title | `title` | Required |
| Assignee | `assignee_id` | Dropdown of roster members, or Unassigned |
| Due date | `due_date` | Optional; overdue tasks highlighted |
| Priority | `priority` | High / Medium / Low — set manually, no auto-calculation |
| Est. work hours | `est_work_hours` | Actual hands-on effort |
| Est. calendar days | `est_calendar_days` | Wall-clock time, accounting for waiting on others |
| Status | `is_complete` | Open / Done (stored as a boolean) |
| Project / group | `project_label` | Optional; autocompletes from labels already used |
| Notes | `notes` | Optional, free text |

## Setup

Run these in the Supabase SQL Editor **in order**, once each:

1. [`supabase/schema.sql`](supabase/schema.sql) — creates the `todos` table.
   *(Skip if you already ran it.)*
2. [`supabase/migration-001-task-fields.sql`](supabase/migration-001-task-fields.sql) —
   adds assignee, dates, priority, estimates, label, notes.
3. [`supabase/migration-002-members-and-sharing.sql`](supabase/migration-002-members-and-sharing.sql) —
   adds the roster and switches RLS from private-per-user to shared-board.
4. [`supabase/migration-003-capacity.sql`](supabase/migration-003-capacity.sql) —
   adds per-member daily capacity for the Today page's overload flag.
5. [`supabase/migration-004-archive.sql`](supabase/migration-004-archive.sql) —
   adds `completed_at` and the Archive view.
6. [`supabase/seed-001-initial-task-list.sql`](supabase/seed-001-initial-task-list.sql) —
   loads the existing 46-task list and adds Elise and Kate to the roster.

Then in **Project Settings → API**, copy the Project URL and anon public key
into [`config.js`](config.js), and in **Authentication → URL Configuration**
set Site URL to `https://akuehnl.github.io/TCAAPP/` (add
`http://localhost:5500/` as a redirect URL for local testing).

## Run locally

```bash
npx serve -l 5500 .
```

## Deploy

Push to `main`; GitHub Pages redeploys automatically. Pages is configured
under repo **Settings → Pages**: deploy from branch `main`, folder `/ (root)`.

## Notes

- `config.js` is committed with real values because the anon key is designed
  to be public in client-side apps — data is protected by the Row Level
  Security policies, not by hiding the key. Never commit the database password
  or the `service_role` key.
- The board syncs live across tabs and devices via Supabase Realtime.
- Priority is manual. The Today page derives urgency from lead time instead,
  so priority acts as a manual tiebreaker rather than the main signal.
- Completed tasks carry a `completed_at` timestamp, kept in sync by a database
  trigger so it stays correct whether a task is closed from the app, the SQL
  editor, or an import. The 15 pre-completed seed rows had no real completion
  date on record, so they were backfilled from their due dates.
- Still to build: a calendar view on the main board, plotting each task's
  start-by → due span.
- Daily digest / overdue reminder emails were scoped out for now.
