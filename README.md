# To-Do App

A simple to-do list with email/password accounts (each user sees only their
own tasks). Static frontend (HTML/CSS/JS, no build step) backed by
[Supabase](https://supabase.com) (Postgres + Auth), hosted on GitHub Pages.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → sign in → **New project**.
2. Pick a name, database password, and region. Wait ~2 minutes for it to provision.
3. In the left sidebar go to **SQL Editor → New query**, paste the contents
   of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. This
   creates the `todos` table with Row Level Security so each user can only
   read/write their own rows.
4. Go to **Project Settings → API**. Copy the **Project URL** and the
   **anon public** key.
5. (Optional, recommended for quick testing) Go to **Authentication →
   Providers → Email** and turn off "Confirm email" if you don't want to
   click a confirmation link every time you sign up a test account. Leave it
   on for a real deployment.

## 2. Configure the app

Open [`config.js`](config.js) and paste in the values from step 1.4:

```js
const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";
```

The anon key is meant to be public in client-side apps like this one — your
data is protected by the Row Level Security policies in `schema.sql`, not by
hiding the key.

## 3. Try it locally (optional)

Any static file server works, e.g.:

```bash
npx serve .
```

Then open the printed localhost URL, sign up with an email/password, and add
some tasks.

## 4. Push to GitHub

```bash
git init
git add .
git commit -m "Initial to-do app"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## 5. Enable GitHub Pages

1. On GitHub, open the repo → **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to "Deploy from a branch".
3. Set **Branch** to `main` and folder to `/ (root)`, then **Save**.
4. After a minute, your app will be live at
   `https://<your-username>.github.io/<your-repo>/`.

## Notes

- `config.js` is committed with real keys since the anon key is safe to
  expose. Don't put your database password or the `service_role` key
  anywhere in this project.
- Tasks update live across tabs/devices via Supabase Realtime.
- To reset everything, drop the `todos` table in the SQL editor and re-run
  `schema.sql`.
