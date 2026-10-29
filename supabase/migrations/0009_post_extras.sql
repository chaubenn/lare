-- Lare 0009: the optional extras an author switches on for a post.
--
-- Three of them are the toggles that sit together in the draft editor ("what ships with this
-- post"):
--   * include_ai_insights (0001) — the transcript and graded debrief travel with the post.
--   * include_og_card              — the generated session card leads the post and is what a
--                                    shared link unfurls to. Off: the post starts at the session
--                                    breakdown and links unfurl to the generic Lare card.
--   * og_show_ai_scores            — draw the AI review percentages (overall + the five skill
--                                    scores) on that card.
--
-- The fourth column pair is the second video slot. A mock interview post carries the full
-- recording in `video_id`; `demo_video_id` is the short summary the author records afterwards
-- (how it went, what they'd change), and it plays *before* the full take:
--
--   session card -> session breakdown -> summary video -> photos -> full recording
--
-- `show_demo_video` mirrors `show_video`, so either video can be held back without detaching it.

alter table public.posts
  add column if not exists include_og_card boolean not null default true,
  add column if not exists og_show_ai_scores boolean not null default false,
  add column if not exists demo_video_id uuid references public.videos (id) on delete set null,
  add column if not exists show_demo_video boolean not null default true;

comment on column public.posts.include_og_card is
  'Lead the post with the generated session card and unfurl shared links to it. When false the '
  'card is neither generated nor attached, and /api/og/{id} falls back to the generic Lare card.';
comment on column public.posts.og_show_ai_scores is
  'Draw the AI review percentages on the session card. Only has an effect for interview sessions '
  'that have an interview_reviews row.';
comment on column public.posts.demo_video_id is
  'Optional second video: the summary/demo clip, shown as its own slide before video_id.';
comment on column public.posts.show_demo_video is
  'Show the summary video as a carousel slide. Ignored when demo_video_id is null.';

-- A post's own summary video may not be the video of a different post, and a video row is
-- never shared between the two slots of one post.
alter table public.posts drop constraint if exists posts_distinct_video_slots;
alter table public.posts add constraint posts_distinct_video_slots
  check (demo_video_id is null or demo_video_id is distinct from video_id);

-- `feed` returns `setof public.posts`, so it has to be re-planned against the widened row type.
create or replace function public.feed(
  before timestamptz default null,
  page_size integer default 20,
  scope text default 'all'
)
returns setof public.posts
language sql
stable
security invoker
set search_path = public
as $$
  select p.*
  from public.posts p
  where p.status = 'published'
    and (before is null or p.published_at < before)
    and (
      coalesce(scope, 'all') <> 'following'
      or p.user_id in (
        select f.followee_id
        from public.follows f
        where f.follower_id = auth.uid() and f.status = 'accepted'
      )
    )
  order by p.published_at desc
  limit least(greatest(coalesce(page_size, 20), 1), 50);
$$;

grant execute on function public.feed(timestamptz, integer, text) to anon, authenticated;
