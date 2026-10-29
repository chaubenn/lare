-- Lare 0020: a post may only point at its author's own session, videos and cover image.
--
-- `posts_insert` / `posts_update` pin `user_id` to the caller and say nothing about the rows a
-- post references. Every visibility helper then trusts the post: `private.can_view_session`
-- (and through it the RLS on session_problems, submissions and session_events) opens a session
-- to whoever can view a post that references it, `can_view_session_insights` does the same for
-- the transcript and the AI review when `include_ai_insights` is on, and `can_view_video`
-- (playback tokens, thumbnails) does it for `video_id` / `demo_video_id`.
--
-- So an author who knew another user's session or video id could publish a public post that
-- referenced it and read, or hand out, that user's code, transcript, review and video. Those
-- ids are not secrets: every post row a viewer has ever loaded carries its `session_id` and
-- video ids, so a clip its owner later hid (0019) or unpublished could be brought back this way.
--
-- Same shape as `check_video_session_owner` (0015): a trigger, because the rule is about the
-- referenced row's owner and RLS cannot compare against another table without a definer helper
-- anyway. It applies to every role, the service role included; the Edge Functions only ever
-- write a user's own rows. `cover_media_id` has to be one of the post's own media rows.
--
-- Idempotent: safe to run twice.

create or replace function public.check_post_references_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.session_id is not null and not exists (
    select 1 from public.sessions s where s.id = new.session_id and s.user_id = new.user_id
  ) then
    raise exception 'Session not found' using errcode = '42501';
  end if;
  if new.video_id is not null and not exists (
    select 1 from public.videos v where v.id = new.video_id and v.user_id = new.user_id
  ) then
    raise exception 'Video not found' using errcode = '42501';
  end if;
  if new.demo_video_id is not null and not exists (
    select 1 from public.videos v where v.id = new.demo_video_id and v.user_id = new.user_id
  ) then
    raise exception 'Video not found' using errcode = '42501';
  end if;
  if new.cover_media_id is not null and not exists (
    select 1 from public.post_media m where m.id = new.cover_media_id and m.post_id = new.id
  ) then
    raise exception 'Cover image not found' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.check_post_references_owner() from public, anon, authenticated;

drop trigger if exists posts_references_owner on public.posts;
create trigger posts_references_owner
  before insert or update of user_id, session_id, video_id, demo_video_id, cover_media_id
  on public.posts
  for each row execute function public.check_post_references_owner();
