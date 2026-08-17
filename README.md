# TCA Tasks

A task tracker with email/password accounts (each user sees only their own
tasks). Static frontend (HTML/CSS/JS, no build step) backed by
[Supabase](https://supabase.com) (Postgres + Auth), hosted on GitHub Pages.

Live at **https://akuehnl.github.io/TCAAPP/**

## Task fields

| Field | Column | Notes |
| --- | --- | --- |
| Title | `title` | Required |
| Assignee | `assignee` | Board member or helper; free text, autocompletes from names already used |
| Due date | `due_date` | Optional; overdue tasks are highlighted in red |
| Priority | `priority` | High / Medium / Low — set manually, no auto-calculation |
| Est. work hours | `est_work_hours` | Actual hands-on effort |
| Est. calendar days | `est_calendar_days` | Wall-clock time, accounting for waiting on others |
| Status | `is_complete` | Open / Done (stored as a boolean) |
| Project / group | `project_label` | Optional; autocompletes from labels already used |
| Notes | `notes` | Optional, free text |

Tasks sort open-first, then by soonest due date (undated last), then by
priority. "Hide done" filters completed tasks out of the list.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → sign in → **New project**.
2. Pick a name, database password, and region. Wait ~2 minutes to provision.
3. In the sidebar go to **SQL Editor → New query**, paste the contents of
   [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. This
   creates the `todos` table with Row Level Security so each user can only
   read/write their own rows.
4. Go to **Project Settings → API**. Copy the **Project URL** and the
   **anon public** key into [`config.js`](config.js).
5. Go to **Authentication → URL Configuration** and set **Site URL** to your
   deployed address (e.g. `https://akuehnl.github.io/TCAAPP/`). Add both that
   URL and `http://localhost:5500/` under **Redirect URLs**. Skipping this
   sends confirmation emails to Supabase's default `localhost:3000`.

### Already have the old single-field table?

Run [`supabase/migration-001-task-fields.sql`](supabase/migration-001-task-fields.sql)
in the SQL Editor instead of `schema.sql`. It renames `task` → `title`, adds
the new columns, and preserves existing rows. It's safe to run more than once.

## 2. Run it locally

Any static file server works:

```bash
npx serve -l 5500 .
```

Then open http://localhost:5500 and sign in.

## 3. Deploy

Push to `main` — GitHub Pages redeploys automatically:

```bash
git push
```

Pages is configured under repo **Settings → Pages**: source "Deploy from a
branch", branch `main`, folder `/ (root)`.

## Notes

- `config.js` is committed with real values because the anon key is designed
  to be public in client-side apps — your data is protected by the Row Level
  Security policies in `schema.sql`, not by hiding the key. Never commit your
  database password or the `service_role` key.
- Tasks sync live across tabs and devices via Supabase Realtime.
- Priority is manual in Phase 1. Auto-calculation from due date, work hours,
  and calendar days is a possible Phase 2.
