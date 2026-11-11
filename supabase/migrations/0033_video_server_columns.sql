-- Lare 0033: Bunny decides when a video is ready, and a post's place in the feed is set once.
--
-- 1. Server-owned video columns.
--    `videos_update` (0001) lets an owner update any column of their own video. 0018 made
--    `status = 'ready'` the moment a pending post is released and its `published_at` moves to now,
--    and the definer trigger that does it passes the 0026 guard. So an owner could flip their video
--    `processing` -> `ready` in a loop and put their post back at the top of every feed each time,
--    or release a pending post before Bunny had processed anything.
--
--    For the API roles (`anon`, `authenticated`), as in 0026 (the trigger is not security definer,
--    so `current_user` is the role that ran the statement; Edge Functions and definer code are
--    unaffected):
--      * `status`: the one client transition is `created -> uploading`, which installed desktop
--        builds send before their upload starts. Those builds send it on every attempt, including
--        a retry after Bunny has already moved the video on, so a late `uploading` keeps the
--        server's status instead of failing their upload. Any other status is refused.
--      * `error`: refused; only the Bunny webhook writes it.
--      * `duration_ms`, `width`, `height`: the desktop writes provisional values from the local file
--        so the draft can lay the video out while it uploads. They are pinned once the video is
--        ready, because from then on they come from Bunny.
--    For every role, `ready_at` is stamped by the database the first time a video becomes ready
--    and never changes after that, so a replayed or repeated ready webhook cannot move it.
--
-- 2. A post goes live once.
--    `published_at` is what feeds order by. 0018 moves it to now when the last video a post shows
--    becomes ready, and 0026 stamps a fresh one every time a draft is published. Each of those
--    could be repeated to bump a post that had already been seen: attach a new video to a live post
--    and wait for it, or unpublish and publish again.
--
--    `post_first_live` records, for each post, the `published_at` it had the first time it was live
--    (published, and every video it shows ready). Server-only: no API role can read or write it.
--      * Recorded by a trigger on posts whenever a published post is (or becomes) live, from any
--        path: publishing a post whose videos are ready, a video becoming ready, or hiding the
--        video a post was waiting on.
--      * The video-ready trigger (0018) only moves `published_at` for a post that has never been
--        live, so a pending post still lands at the top of feeds once, when it is first released.
--      * Publishing a post that has been live before restores its first `published_at`, so
--        unpublishing and publishing again puts it back where it was rather than at the top.
--    Existing published posts that are live now are recorded with their current `published_at`.
--
-- Idempotent: safe to run twice.

-- ---------------------------------------------------------------------------
-- videos: server-owned columns
-- ---------------------------------------------------------------------------
create or replace function private.protect_video_server_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.status is distinct from old.status then
      if new.status = 'uploading' and old.status = 'created' then
        null;
      elsif new.status = 'uploading' then
        new.status := old.status;
      else
        raise exception 'Video status is set by the server' using errcode = '42501';
      end if;
    end if;
    if new.error is distinct from old.error then
      raise exception 'Video errors are set by the server' using errcode = '42501';
    end if;
    if old.status = 'ready' then
      new.duration_ms := old.duration_ms;
      new.width := old.width;
      new.height := old.height;
    end if;
  end if;

  if new.status = 'ready' and old.status is distinct from 'ready' then
    new.ready_at := now();
  else
    new.ready_at := old.ready_at;
  end if;
  return new;
end $$;

revoke all on function private.protect_video_server_columns() from public, anon, authenticated;

drop trigger if exists videos_protect_server_columns on public.videos;
create trigger videos_protect_server_columns before update on public.videos
  for each row execute function private.protect_video_server_columns();

-- ---------------------------------------------------------------------------
-- post_first_live
-- ---------------------------------------------------------------------------
create table if not exists public.post_first_live (
  post_id uuid primary key references public.posts (id) on delete cascade,
  -- The post's published_at when it first went live.
  published_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.post_first_live enable row level security;
-- No policies, and no table privileges to back them either.
revoke all on public.post_first_live from anon, authenticated;

create or replace function private.record_post_first_live()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.post_videos_ready(new) then
    insert into public.post_first_live (post_id, published_at)
    values (new.id, coalesce(new.published_at, now()))
    on conflict (post_id) do nothing;
  end if;
  return null;
end $$;

revoke all on function private.record_post_first_live() from public, anon, authenticated;

drop trigger if exists posts_record_first_live on public.posts;
create trigger posts_record_first_live
  after insert or update of status, published_at, video_id, demo_video_id, show_video, show_demo_video, video_kind
  on public.posts
  for each row
  when (new.status = 'published')
  execute function private.record_post_first_live();

-- Draft -> published, for a post that has been live before: back to its first published_at.
-- Named to sort after `posts_protect_server_columns` (0026), which stamps now() on the same
-- transition for the API roles; BEFORE triggers fire in name order.
create or replace function private.keep_first_published_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_published timestamptz;
begin
  if old.status = 'draft' and new.status = 'published' then
    select l.published_at into first_published
    from public.post_first_live l
    where l.post_id = new.id;
    if found then
      new.published_at := first_published;
    end if;
  end if;
  return new;
end $$;

revoke all on function private.keep_first_published_at() from public, anon, authenticated;

drop trigger if exists posts_republish_first_live on public.posts;
create trigger posts_republish_first_live before update of status on public.posts
  for each row execute function private.keep_first_published_at();

-- 0018, now only for posts that have never been live.
create or replace function private.publish_posts_when_videos_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    update public.posts p
    set published_at = now()
    where p.status = 'published'
      and (
        (p.video_id = new.id and p.show_video and p.video_kind <> 'none')
        or (p.demo_video_id = new.id and p.show_demo_video)
      )
      and private.post_videos_ready(p)
      and not exists (select 1 from public.post_first_live l where l.post_id = p.id);
  end if;
  return new;
end $$;

revoke all on function private.publish_posts_when_videos_ready() from public, anon, authenticated;

-- Posts that are live now went live at their current published_at.
insert into public.post_first_live (post_id, published_at)
select p.id, p.published_at
from public.posts p
where p.status = 'published'
  and p.published_at is not null
  and private.post_videos_ready(p)
on conflict (post_id) do nothing;
