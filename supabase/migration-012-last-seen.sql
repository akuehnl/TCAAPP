-- Migration 012: track when each person last used the app.
--
-- Deliberately not read from auth.users.last_sign_in_at: sessions persist for
-- weeks, so someone can open the app every day without ever signing in again,
-- and that column would show a stale date from whenever they first logged in.
--
-- Run in the Supabase SQL Editor AFTER migration 011. Safe to re-run.

alter table public.members add column if not exists last_seen_at timestamptz;

-- Each person stamps only their own row. SECURITY DEFINER because the members
-- UPDATE policy is admin-only, and this has to work for everyone.
create or replace function public.touch_last_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.members
     set last_seen_at = now()
   where user_id = auth.uid();
end;
$$;

revoke all on function public.touch_last_seen() from public;
grant execute on function public.touch_last_seen() to authenticated;
