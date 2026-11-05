-- Lare 0029: feed pages by (published_at, id), and indexes the hot lookups were missing.
--
-- `feed(before, ...)` paged on `published_at < before` and ordered by published_at alone. Posts
-- that share a timestamp (0018 stamps every post released by the same video-ready update with
-- one `now()`) are in no stable order, and the ones on the far side of a page break are skipped
-- for good, because the next page asks for strictly older timestamps.
--
-- The fix is a keyset on (published_at, id) with a tie-break order. `before_id` is a new, optional
-- fourth argument: callers that pass it get exact paging; callers that only pass `before` keep the
-- old behaviour, so existing clients are unaffected. Dropped and recreated rather than replaced,
-- as in 0006, because an extra defaulted argument would otherwise be a second overload and make
-- three-argument calls ambiguous.
--
-- Indexes:
--   * posts.video_id / posts.demo_video_id — `can_view_video`, the video-ready trigger (0018),
--     `video-delete` and `on delete set null` from videos all look posts up by these.
--   * notifications unread per recipient — the desktop badge counts `read_at is null` every two
--     minutes; the existing (recipient_id, created_at) index has to read every row to find them.
--   * submissions (submitted_at) where accepted is created in 0028 for the leaderboards.
--
-- Idempotent: safe to run twice.

drop function if exists public.feed(timestamptz, integer, text);

create or replace function public.feed(
  before timestamptz default null,
  page_size integer default 20,
  scope text default 'all',
  before_id uuid default null
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
    and (
      before is null
      or p.published_at < before
      -- Same timestamp as the last row of the previous page: continue below its id.
      or (before_id is not null and p.published_at = before and p.id < before_id)
    )
    and (
      -- 'all': everything RLS lets the viewer see.
      -- 'following': only accounts the viewer follows with an accepted edge.
      coalesce(scope, 'all') <> 'following'
      or p.user_id in (
        select f.followee_id
        from public.follows f
        where f.follower_id = auth.uid() and f.status = 'accepted'
      )
    )
  order by p.published_at desc, p.id desc
  limit least(greatest(coalesce(page_size, 20), 1), 50);
$$;

grant execute on function public.feed(timestamptz, integer, text, uuid) to anon, authenticated;

create index if not exists posts_video_id_idx
  on public.posts (video_id) where video_id is not null;
create index if not exists posts_demo_video_id_idx
  on public.posts (demo_video_id) where demo_video_id is not null;

create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_id, created_at desc)
  where read_at is null;
