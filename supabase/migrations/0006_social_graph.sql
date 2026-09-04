-- Social graph: a global feed, a "following only" filter, and the solved-problems
-- activity grid rendered on profiles.
--
-- Visibility is unchanged and still lives entirely in `private.can_view_post`:
--   * public account   -> published public posts are visible to everyone, signed in or not
--   * private account  -> published public posts only to the owner and accepted followers
--   * private post     -> owner only, whatever the account's privacy is
-- `feed` is security invoker, so RLS on public.posts applies those rules; the function
-- only decides which slice of the visible posts to page through.

-- ---------------------------------------------------------------------------
-- feed(before, page_size, scope)
-- ---------------------------------------------------------------------------
-- Dropped rather than replaced: adding a third defaulted argument would create an
-- overload and make the existing two-argument calls ambiguous.
drop function if exists public.feed(timestamptz, integer);

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
      -- 'all': everything RLS lets the viewer see.
      -- 'following': only accounts the viewer follows with an accepted edge.
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

-- ---------------------------------------------------------------------------
-- solved_activity(target_handle, days) -> GitHub-style contribution grid
-- ---------------------------------------------------------------------------
-- Counts accepted submissions straight from the session tables, so problems solved
-- in sessions that were never posted (or were posted privately) still contribute.
-- Security definer because `submissions` is owner-only under RLS; the privacy gate is
-- the same `can_view_profile_content` used everywhere else, so a private account's grid
-- stays hidden from anyone who is not an accepted follower.
--
-- Days are bucketed in UTC so the grid is identical for every viewer.
create or replace function public.solved_activity(
  target_handle extensions.citext,
  days integer default 365
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.profiles%rowtype;
  window_days integer := least(greatest(coalesce(days, 365), 7), 366);
  first_day date := (now() at time zone 'utc')::date - (window_days - 1);
  last_day date := (now() at time zone 'utc')::date;
  buckets jsonb;
begin
  select * into target from public.profiles where handle = target_handle;
  if target.id is null then return null; end if;

  if not private.can_view_profile_content(target.id) then
    return jsonb_build_object(
      'visible', false, 'start', first_day, 'end', last_day,
      'days', '[]'::jsonb, 'total', 0, 'max', 0, 'all_time', 0
    );
  end if;

  with solved as (
    select distinct
      (su.submitted_at at time zone 'utc')::date as day,
      sp.slug
    from public.submissions su
    join public.session_problems sp on sp.id = su.session_problem_id
    join public.sessions s on s.id = sp.session_id
    where s.user_id = target.id
      and su.accepted
      and (su.submitted_at at time zone 'utc')::date between first_day and last_day
  ), per_day as (
    select day, count(*)::int as solves from solved group by day
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('day', day, 'count', solves) order by day),
    '[]'::jsonb
  ) into buckets
  from per_day;

  return jsonb_build_object(
    'visible', true,
    'start', first_day,
    'end', last_day,
    'days', buckets,
    'total', (select coalesce(sum((d ->> 'count')::int), 0) from jsonb_array_elements(buckets) d),
    'max', (select coalesce(max((d ->> 'count')::int), 0) from jsonb_array_elements(buckets) d),
    'all_time', (
      select count(distinct sp.slug)
      from public.session_problems sp
      join public.sessions s on s.id = sp.session_id
      join public.submissions su on su.session_problem_id = sp.id and su.accepted
      where s.user_id = target.id
    )
  );
end $$;

grant execute on function public.solved_activity(extensions.citext, integer) to anon, authenticated;

-- The friends tab's people search needs nothing new: `profiles_select` is `using (true)`
-- (the handle directory is public), so it queries the table directly.
