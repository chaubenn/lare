-- Lare 0022: global leaderboard.
--
-- Adds global_leaderboard(week_offset, max_rows) — distinct problems solved in a UTC
-- Monday–Sunday week by everyone with a public account, ranked. weekly_leaderboard (0017) stays
-- the friends board.
--
-- Private accounts are never on the board anyone else reads: rows holds public profiles only, and
-- the board is built per caller. A private caller still sees where they stand — `viewer` is their
-- own row, ranked as if they were on the board (one place below everyone strictly ahead of them,
-- tied with anyone on the same total) without that ranking moving anyone else's place. Public
-- places are computed among public profiles only, so every caller sees the same ones.
--
-- Only people who solved something that week are ranked. A problem solved several times in the
-- week counts once, and accounts without a handle (not onboarded) are left out, exactly as in the
-- friends board.
--
-- Security definer because `submissions` is owner-only under RLS; the function only ever returns
-- public profiles' counts plus the caller's own. Idempotent: safe to run twice.

create or replace function public.global_leaderboard(
  week_offset integer default 0,
  max_rows integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  first_day date := date_trunc('week', now() at time zone 'utc')::date
    + 7 * least(greatest(coalesce(week_offset, 0), -52), 0);
  from_ts timestamptz := first_day::timestamp at time zone 'utc';
  to_ts timestamptz := (first_day + 7)::timestamp at time zone 'utc';
  row_limit integer := least(greatest(coalesce(max_rows, 100), 1), 100);
  result jsonb;
begin
  if viewer is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  with solved as (
    select distinct on (s.user_id, sp.slug) s.user_id, sp.slug, sp.difficulty
    from public.submissions su
    join public.session_problems sp on sp.id = su.session_problem_id
    join public.sessions s on s.id = sp.session_id
    join public.profiles pr on pr.id = s.user_id
    where su.accepted
      and su.submitted_at >= from_ts
      and su.submitted_at < to_ts
      and pr.handle is not null
      and (not pr.is_private or s.user_id = viewer)
    order by s.user_id, sp.slug, su.submitted_at
  ), totals as (
    select
      pr.id as user_id, pr.handle::text as handle, pr.display_name, pr.avatar_url, pr.is_private,
      count(so.slug)::int as total,
      (count(so.slug) filter (where so.difficulty = 'Easy'))::int as easy,
      (count(so.slug) filter (where so.difficulty = 'Medium'))::int as medium,
      (count(so.slug) filter (where so.difficulty = 'Hard'))::int as hard
    from solved so
    join public.profiles pr on pr.id = so.user_id
    group by pr.id
  ), public_totals as (
    select * from totals t where not t.is_private
  ), ranked as (
    select t.*, (rank() over (order by t.total desc))::int as place
    from public_totals t
  ), top as (
    select * from ranked r order by r.place, r.hard desc, r.medium desc, r.handle limit row_limit
  ), me as (
    -- The caller's own standing, public or private. No solves this week means no place yet.
    select
      pr.id, pr.handle::text as handle, pr.display_name, pr.avatar_url, pr.is_private,
      coalesce(t.total, 0) as total,
      coalesce(t.easy, 0) as easy,
      coalesce(t.medium, 0) as medium,
      coalesce(t.hard, 0) as hard,
      case
        when coalesce(t.total, 0) = 0 then null
        else 1 + (select count(*) from public_totals o where o.total > t.total)
      end as place
    from public.profiles pr
    left join totals t on t.user_id = pr.id
    where pr.id = viewer and pr.handle is not null
  )
  select jsonb_build_object(
    'week_start', first_day,
    'week_end', first_day + 6,
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', r.user_id,
          'handle', r.handle,
          'display_name', r.display_name,
          'avatar_url', r.avatar_url,
          'total', r.total,
          'easy', r.easy,
          'medium', r.medium,
          'hard', r.hard,
          'rank', r.place,
          'is_viewer', r.user_id = viewer
        )
        order by r.place, r.hard desc, r.medium desc, r.handle
      )
      from top r
    ), '[]'::jsonb),
    'viewer', (
      select jsonb_build_object(
        'user_id', m.id,
        'handle', m.handle,
        'display_name', m.display_name,
        'avatar_url', m.avatar_url,
        'total', m.total,
        'easy', m.easy,
        'medium', m.medium,
        'hard', m.hard,
        'rank', m.place,
        'is_viewer', true,
        'is_private', m.is_private
      )
      from me m
    ),
    'ranked_count', (select count(*)::int from public_totals)
  ) into result;

  return result;
end $$;

revoke execute on function public.global_leaderboard(integer, integer) from public, anon;
grant execute on function public.global_leaderboard(integer, integer) to authenticated;
