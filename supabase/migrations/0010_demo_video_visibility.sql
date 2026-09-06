-- `private.can_view_video` predates `posts.demo_video_id` (added in 0009_post_extras.sql)
-- and was never updated to recognize it, so a post's demo video (and its thumbnail, via the
-- `thumbnails_viewer_select` storage policy that also calls this function) was invisible to
-- anyone but the video's owner, even on a published public post with the demo video shown.
create or replace function private.can_view_video(vid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.videos v where v.id = vid and v.user_id = auth.uid())
    or exists (select 1 from public.posts p where p.video_id = vid and private.can_view_post(p))
    or exists (select 1 from public.posts p where p.demo_video_id = vid and private.can_view_post(p));
$$;
