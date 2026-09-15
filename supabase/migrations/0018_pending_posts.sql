-- Lare 0018: posts wait for their videos.
--
-- An author can publish while a video is still processing on Bunny. The post is theirs to see
-- straight away, but nobody else sees it until every video it shows is `ready`; at that moment
-- `published_at` moves to now, so it lands at the top of feeds instead of behind posts published
-- while it waited. There is no separate pending status: "pending" is a published post whose shown
-- videos are not all ready, and every visibility check built on `private.can_view_post` (the feed
-- through posts RLS, sessions, videos, comments, likes, media, the OG card) follows from it.
--
-- A hidden video (`show_video` / `show_demo_video` false) never holds a post back, and neither
-- does `video_id` on a post whose `video_kind` is `none`.
--
-- Idempotent: safe to run twice.

create or replace function private.video_ready(vid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.videos v where v.id = vid and v.status = 'ready');
$$;

create or replace function private.post_videos_ready(p public.posts)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (p.video_id is null or not p.show_video or p.video_kind = 'none' or private.video_ready(p.video_id))
     and (p.demo_video_id is null or not p.show_demo_video or private.video_ready(p.demo_video_id));
$$;

create or replace function private.can_view_post(p public.posts)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id = auth.uid()
    or (
      p.status = 'published'
      and p.visibility = 'public'
      and private.post_videos_ready(p)
      and private.can_view_profile_content(p.user_id)
    );
$$;

-- When a video finishes processing, publish the posts it was the last thing holding back.
create or replace function private.publish_posts_when_videos_ready()
returns trigger
language plpgsql
security definer
set search_path = public
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
      and private.post_videos_ready(p);
  end if;
  return new;
end $$;

drop trigger if exists videos_ready_publish on public.videos;
create trigger videos_ready_publish after update of status on public.videos
  for each row execute function private.publish_posts_when_videos_ready();

-- Policies call these as the requesting role, like the other private helpers.
grant execute on all functions in schema private to anon, authenticated, service_role;
