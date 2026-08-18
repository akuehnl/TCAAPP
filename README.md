# TCA Tasks

A shared workspace for the Tyndale Classical Academy board. Static frontend
(HTML/CSS/JS, no build step) backed by [Supabase](https://supabase.com)
(Postgres + Auth), hosted free on GitHub Pages.

Live at **https://akuehnl.github.io/TCAAPP/**

Two sections, switched from the top of the page:

| Section | Purpose |
| --- | --- |
| **Tasks** | The board's work — who owns what, what's due, what needs starting today |
| **Board Meetings** | Agenda suggestions and the chair-approved agenda for each Tuesday meeting |
| **People** | The roster — who's active, who chairs the board, who administers it |

## Task views

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

## Board Meetings

Meetings are weekly on **Tuesdays**. The date shown defaults to the next
Tuesday (on a Tuesday it stays on that day rather than skipping a week), and
the arrows step back and forward a week at a time, so past agendas stay
readable.

| Tab | Purpose |
| --- | --- |
| **Suggestions** | Anyone on the roster proposes a topic: title, description, estimated minutes, and whether it puts forward a motion to vote on |
| **Approved agenda** | What the chair has accepted, in the order it will be taken, numbered — and where minutes are taken during the meeting |
| **Completed meetings** | The archive: past meetings with their full minutes, motions and roll calls |

### Attendance

Taken at the top of the agenda, before discussion starts. The named roll is
the **five voting board members**, each marked **Present**, **Absent** or
**Excused**. Anyone else who attends — staff, a parent, a vendor — is
**written in as a guest**, including other app users such as Elise and Kate.

The header counts present, absent, excused and guests, and states how many of
the voting members are present. That is deliberately a count rather than a
quorum verdict: quorum rules are the board's to define, not the app's to
assume.

### Minutes

During the meeting, each approved item carries its own minutes block:

- **Notes** — any number of discussion points, each stamped with who wrote it
  and when. Authors can correct their own; the chair or an admin can correct
  anyone's.
- **Motions** — recorded against *any* item, whether or not it was flagged as
  a motion when suggested, because motions arise mid-discussion. Each records
  the wording, who moved and seconded it, and the chair's declared outcome
  (carried / failed / tabled / withdrawn).
- **Roll call** — every active *voting* member is marked **Yea**, **Nay** or
  **Abstain**. Staff on the roster (Elise, Kate) do not appear: they are there
  to be assigned tasks and named on agenda items, not to vote. The same
  restriction applies to who can move and second a motion. Tallies are counted from those rows rather than stored, so they
  cannot drift out of step with the individual votes. Members with no vote
  recorded show a dash in the archive.
- **Mark as discussed** — a full-width button at the foot of each item, below
  the minutes, since you tick an item off once the discussion is written up.
  It fills green when set, and clicking again reopens the item. Open to any
  member, not just the chair.

**Taking minutes is open to every member**, verified across all of them: any
member can add notes, record motions, cast the roll call, mark items
discussed, take attendance and write in guests. The only per-person rule is on
*correcting an existing entry* — you may edit or delete your own, and the chair
or an admin may edit or delete anyone's. Nothing here is restricted to the
secretary.

### Closing a meeting

The chair or an admin closes the meeting from the toolbar. If any items are
not marked discussed, you are asked whether to **carry them to next week** or
archive them as they stand — left alone they would vanish into the archive
undiscussed, which is the wrong default for a board. Carried items keep their
order and land after anything already scheduled.

A closed meeting is read-only: notes, motions, votes, attendance and
reordering all lock, and the summary turns green. The chair or an admin can
**reopen** it two ways — the toolbar button on that meeting's agenda, or the
**Reopen** button beside it in the Completed meetings archive, which also
jumps you back to the agenda to carry on editing.

The estimated meeting length sits at the top, summed from the approved items,
alongside the motion count and how much more time the pending suggestions
would add. Past 90 minutes the estimate turns red.

**Only the chair or an admin** can approve, decline, reorder, or edit approved
items, or add an item straight to the agenda without going through
suggestions. Everyone else can edit or withdraw their own suggestions while
those are still pending. This is enforced by Row Level Security policies, not
just hidden in the UI, so it holds even against direct API calls.

## Roles

| Role | Column | Who | Can |
| --- | --- | --- | --- |
| Admin | `is_admin` | Aden | Everything a chair can, plus change the chair and activate/deactivate members |
| Board Chair | `is_chair` | Josiah (changeable in-app) | Approve, decline, reorder and edit agenda items |
| Member | — | Everyone else on the roster | All task work; suggest agenda items and edit their own pending ones |
| Voting | `can_vote` | The five board members | Appear on the roll call, and may move or second a motion |

Staff (Elise, Kate) are on the roster so they can hold tasks and be named on
agenda items, but `can_vote` is false, so they never appear on a roll call. An
admin can change that per person from the People section.

The chair is changed from the **People** section — no code or SQL edit. Because
every permission check reads the `members` table at query time, a change takes
effect immediately for everyone, without anyone signing out.

Both roster changes go through database functions rather than direct table
writes, so the invariants live in one place:

- `set_board_chair()` sets every row in a single statement, so there is never a
  moment with two chairs or none, and refuses inactive members.
- `set_member_active()` refuses to deactivate you (no locking yourself out) or
  the sitting chair (hand the role over first).
- `set_member_admin()` refuses to revoke the last active admin.
- `add_member()` rejects duplicate names and emails, and links the new row to
  an existing login if that person already signed up.
- A trigger blocks `is_chair` / `is_admin` changes that bypass those functions.

From the People section an admin can change the chair, grant or revoke admin,
activate or deactivate someone, and add a new person. Editing an existing
person's role, email, or capacity is still a SQL edit.

Each row also shows when that person **last used the app** — relative for
recent activity ("5 hours ago"), a date once it is over a week old, with the
exact timestamp on hover. This is tracked in `members.last_seen_at` rather
than read from `auth.users.last_sign_in_at`, because sessions persist for
weeks: someone can open the app daily without ever signing in again, and that
column would show a stale date from their first login. The stamp is written
when the app opens and refreshed when a tab that was left open is returned to,
throttled to at most once every 10 minutes. It is visible to everyone on the
roster.

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
6. [`supabase/migration-005-board-meetings.sql`](supabase/migration-005-board-meetings.sql) —
   adds the Board Meetings section, the `is_chair` flag, and its RLS policies.
7. [`supabase/migration-006-admin-and-chair.sql`](supabase/migration-006-admin-and-chair.sql) —
   adds the admin role and in-app chair switching.
8. [`supabase/migration-007-roster-management.sql`](supabase/migration-007-roster-management.sql) —
   adds grant/revoke admin and adding people from the app.
9. [`supabase/migration-008-minutes-and-motions.sql`](supabase/migration-008-minutes-and-motions.sql) —
   adds meeting minutes, motions, roll-call votes and the completed-meetings archive.
10. [`supabase/migration-009-voting-rights.sql`](supabase/migration-009-voting-rights.sql) —
    separates voting board members from non-voting staff.
11. [`supabase/migration-010-attendance.sql`](supabase/migration-010-attendance.sql) —
    adds meeting attendance and guest write-ins.
12. [`supabase/migration-011-attendance-board-only.sql`](supabase/migration-011-attendance-board-only.sql) —
    limits the named attendance roll to board members.
13. [`supabase/migration-012-last-seen.sql`](supabase/migration-012-last-seen.sql) —
    tracks when each person last used the app.
14. [`supabase/seed-001-initial-task-list.sql`](supabase/seed-001-initial-task-list.sql) —
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
