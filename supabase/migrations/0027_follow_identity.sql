-- Lare 0027: neither side of a follow can rewrite who the follow is between.
--
-- `follows_update_accept` (0001) let the followee update their incoming edges and only pinned
-- `followee_id` in its check. So a followee could rewrite `follower_id` on any pending or accepted
-- edge to any other profile, and set `status` while doing it: fabricating "X follows me" for
-- someone who never asked (they would then appear in follower lists, get a follow_accepted
-- notification, and have the followee's posts pushed into their following feed).
--
-- Nothing in the apps updates `follows` directly. Accepting goes through `accept_follow`,
-- declining or removing through `decline_follow` / `remove_follower` (below), following through
-- `request_follow`, all security definer. So the update policy and privilege go away entirely, and
-- a trigger pins the two identity columns for every role, definer paths included, so a future
-- policy or RPC cannot reopen it. Status may only move forward (pending -> accepted), matching
-- `request_follow`'s `greatest(...)` and `accept_follow`.
--
-- Idempotent: safe to run twice.

drop policy if exists follows_update_accept on public.follows;
revoke update on public.follows from anon, authenticated;

create or replace function private.freeze_follow_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.follower_id is distinct from old.follower_id
     or new.followee_id is distinct from old.followee_id then
    raise exception 'A follow cannot be moved to other accounts' using errcode = '42501';
  end if;
  if old.status = 'accepted' and new.status = 'pending' then
    raise exception 'An accepted follow cannot go back to pending' using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  return new;
end $$;

revoke all on function private.freeze_follow_identity() from public, anon, authenticated;

drop trigger if exists follows_freeze_identity on public.follows;
create trigger follows_freeze_identity before update on public.follows
  for each row execute function private.freeze_follow_identity();

-- ---------------------------------------------------------------------------
-- remove_follower(p_follower_id) -> drop someone from your followers
-- ---------------------------------------------------------------------------
-- Deletes the edge from `p_follower_id` to the caller whatever its status, so it both removes an
-- accepted follower and clears a pending request. Removing someone who does not follow you is a
-- no-op. The follows_notify trigger (0017) cleans up the matching notifications.
create or replace function public.remove_follower(p_follower_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.follows
  where follower_id = p_follower_id and followee_id = auth.uid();
end $$;

revoke execute on function public.remove_follower(uuid) from public, anon;
grant execute on function public.remove_follower(uuid) to authenticated;

-- 0002 revoked these from anon and public; grant them explicitly so they do not lean on
-- Supabase's default privileges now that they are the only way to act on a request.
grant execute on function public.accept_follow(uuid) to authenticated;
grant execute on function public.decline_follow(uuid) to authenticated;
