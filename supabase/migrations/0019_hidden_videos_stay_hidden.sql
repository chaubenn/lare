-- Lare 0019: a hidden video is hidden from the database, not just from the page.
--
-- `show_video` and `show_demo_video` let an author keep a clip attached to a post without
-- showing it. Until now those switches only governed rendering: `private.can_view_video`
-- asked whether the *post* was viewable and nothing else, so a viewer of a public post
-- could select the `videos` row — `bunny_video_id` included — for a clip the author had
-- switched off. `bunny-playback-token` delegates authorisation entirely to that same RLS,
-- so the same viewer could also mint a working signed embed URL for it.
--
-- That matters more here than it would elsewhere: the underlying MP4 is guarded only by
-- Bunny's referrer rule (embed player and CDN token auth are mutually exclusive — see
-- docs/privacy.md), so a GUID is effectively a permanent link to the file. Handing one out
-- for a clip the author chose not to show is the leak this closes.
--
-- The predicates match the ones `0018` already uses for readiness, so "shown" means the
-- same thing in both places. The owner branch is untouched: authors still see their own
-- hidden clips, which is what the draft editor and the post page's owner view rely on.
--
-- `storage.objects.thumbnails_viewer_select` calls this function too, so a hidden clip's
-- poster stops being readable in the same change.
--
-- This closes future leakage only. A GUID already handed out keeps working until the video
-- is deleted (`video-delete`), and the referrer-only protection on the file is unchanged.
--
-- Idempotent: safe to run twice.

create or replace function private.can_view_video(vid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.videos v where v.id = vid and v.user_id = auth.uid())
    or exists (
      select 1 from public.posts p
      where p.video_id = vid
        and p.show_video
        and p.video_kind <> 'none'
        and private.can_view_post(p)
    )
    or exists (
      select 1 from public.posts p
      where p.demo_video_id = vid
        and p.show_demo_video
        and private.can_view_post(p)
    );
$$;
