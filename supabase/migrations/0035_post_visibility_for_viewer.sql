-- Lare 0035: one definition of "viewer V can see post P", and comment edits follow it.
--
-- `private.can_view_post` (0018), `can_view_profile_content` (0024) and `is_accepted_follower`
-- (0002) answer for `auth.uid()`. Notifications need the answer for the recipient instead, so 0021
-- wrote `private.user_can_view_post(pid, viewer)` as a hand copy of all three. They agree today,
-- but 0018 and 0024 were both changes to visibility, and the next one would have had to be made in
-- both places with nothing saying so.
--
-- Now the rule is written once, for an explicit viewer:
--   * `private.is_accepted_follower_as(target, viewer)`
--   * `private.can_view_profile_content_as(owner, viewer)`
--   * `private.can_view_post_as(p, viewer)`
-- and the old helpers are thin wrappers: the first three pass `auth.uid()`, `user_can_view_post`
-- looks the post up. Every policy and RPC keeps calling the helper it called before. A null viewer
-- (signed out) is treated exactly as 0024 settled: a real `false`, never null.
--
-- `post_comments_update` (0007) only checked `user_id = auth.uid()`, while reading and inserting
-- comments also require being able to see the post. So a follower removed from a private account
-- could still rewrite their old comments there, and each edit could notify newly mentioned people.
-- Editing now needs the same visibility as commenting. Deleting your own comment does not, so it
-- stays possible to take a comment down from a post you can no longer see.
--
-- Idempotent: safe to run twice.

create or replace function private.is_accepted_follower_as(target uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.follows f
    where f.followee_id = target and f.follower_id = viewer and f.status = 'accepted'
  );
$$;

create or replace function private.can_view_profile_content_as(owner uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select owner is not null
    and (
      coalesce(owner = viewer, false)
      or not exists (select 1 from public.profiles p where p.id = owner and p.is_private)
      or private.is_accepted_follower_as(owner, viewer)
    );
$$;

create or replace function private.can_view_post_as(p public.posts, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.user_id = viewer, false)
    or (
      p.status = 'published'
      and p.visibility = 'public'
      and private.post_videos_ready(p)
      and private.can_view_profile_content_as(p.user_id, viewer)
    );
$$;

revoke all on function private.is_accepted_follower_as(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_view_profile_content_as(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_view_post_as(public.posts, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The existing helpers, now wrappers
-- ---------------------------------------------------------------------------
create or replace function private.is_accepted_follower(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_accepted_follower_as(target, auth.uid());
$$;

create or replace function private.can_view_profile_content(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_view_profile_content_as(owner, auth.uid());
$$;

create or replace function private.can_view_post(p public.posts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_view_post_as(p, auth.uid());
$$;

create or replace function private.user_can_view_post(pid uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.posts p where p.id = pid and private.can_view_post_as(p, viewer)
  );
$$;

revoke all on function private.user_can_view_post(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Comment edits need the post to be visible, like comment inserts
-- ---------------------------------------------------------------------------
drop policy if exists post_comments_update on public.post_comments;
create policy post_comments_update on public.post_comments for update
  using (user_id = auth.uid() and private.can_view_post_id(post_id))
  with check (user_id = auth.uid() and private.can_view_post_id(post_id));
