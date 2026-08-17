# TCA Tasks

A shared task board for the Tyndale Classical Academy board. Static frontend
(HTML/CSS/JS, no build step) backed by [Supabase](https://supabase.com)
(Postgres + Auth), hosted free on GitHub Pages.

Live at **https://akuehnl.github.io/TCAAPP/**

## Views

| View | Shows |
| --- | --- |
| **Shared board** | Every task on the board, with an Assignee filter (Anyone / Unassigned / any member) |
| **My tasks** | Only tasks assigned to the signed-in member |

Tab labels carry live open-task counts. Both views sort open-first, then
soonest due date (undated last), then priority. "Hide done" filters out
completed tasks, and overdue tasks are outlined in red.

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
- Priority is manual (Phase 1). Auto-calculation from due date, work hours,
  and calendar days is a possible Phase 2.
- Daily digest / overdue reminder emails were scoped out for now.
