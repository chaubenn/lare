-- Lare 0028: harder to game the leaderboards with made-up submissions.
--
-- `submissions` rows are written by the extension under the user's own JWT
-- (`submissions_insert` only checks that the problem row is theirs), so anyone can insert rows
-- marked `accepted` for any slug at any time and climb the global board (0022). The database
-- cannot ask LeetCode whether a submission is real, so this is mitigation, not proof:
--
--   * Server-stamped `created_at`. A trigger sets it on insert and pins it on update, so it is
--     the time the row actually reached us. A `submitted_at` more than five minutes in the future
--     is clamped to now (it is the extension's clock; skew is tolerated, time travel is not).
--   * The boards only count an accepted submission that
--       - carries a LeetCode submission id (the extension always has one);
--       - reached us within two days of its `submitted_at`, so a row cannot be backdated into an
--         earlier week (or into this one after the fact) and still count;
--       - is for a slug shaped like a LeetCode slug (lowercase words joined by hyphens), which
--         stops free-form junk, not plausible fakes;
--   * A problem counts once per user per week (already true in 0017/0022), and at most 30 distinct
--     problems per user per UTC day count, which no honest day of practice comes near.
--   * On update, a submission's problem, `submitted_at` and `created_at` are pinned. The
--     extension's upsert re-sends identical values, so this only stops old rows being shuffled
--     into the current week or onto other problems.
--
-- Residual risk, accepted and documented: a determined user can still script inserts of
-- plausible-looking accepted submissions, up to 30 problems a day, timestamped "now". Closing that
-- needs verification against LeetCode (their submission ids are not checkable from here) or
-- moderation. Profiles' own grids (solved_activity, solved_skills, goal_progress) still count
-- every accepted row: they only show users their own claims, and late syncs must not vanish there.
--
-- Both boards now share one definition of "a solve that counts" (`private.leaderboard_solves`).
--
-- Idempotent: safe to run twice.

-- ---------------------------------------------------------------------------
-- Server-owned submission timestamps
-- ---------------------------------------------------------------------------
create or replace function private.stamp_submission()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    if new.submitted_at is null or new.submitted_at > now() + interval '5 minutes' then
      new.submitted_at := now();
    end if;
    return new;
  end if;

  new.session_problem_id := old.session_problem_id;
  new.submitted_at := old.submitted_at;
  new.created_at := old.created_at;
  return new;
end $$;

revoke all on function private.stamp_submission() from public, anon, authenticated;

drop trigger if exists submissions_stamp on public.submissions;
create trigger submissions_stamp before insert or update on public.submissions
  for each row execute function private.stamp_submission();

-- The boards read accepted submissions by week.
create index if not exists submissions_accepted_submitted_idx
  on public.submissions (submitted_at)
  where accepted;

-- ---------------------------------------------------------------------------
-- private.leaderboard_solves(from, to, only_users) -> the (user, problem) pairs that count
-- ---------------------------------------------------------------------------
-- `only_users` narrows the scan for the friends board; null means everyone.
create or replace function private.leaderboard_solves(
  from_ts timestamptz,
  to_ts timestamptz,
  only_users uuid[] default null
)
returns table (user_id uuid, slug text, difficulty public.problem_difficulty)
language sql
stable
security definer
set search_path = public
as $$
  with firsts as (
    -- First qualifying accepted submission of each problem per user in the window.
    select distinct on (s.user_id, sp.slug)
      s.user_id as uid,
      sp.slug as problem,
      sp.difficulty as level,
      su.submitted_at as solved_at
    from public.submissions su
    join public.session_problems sp on sp.id = su.session_problem_id
    join public.sessions s on s.id = sp.session_id
    where su.accepted
      and su.submitted_at >= from_ts
      and su.submitted_at < to_ts
      and su.leetcode_submission_id is not null
      -- Rows from before the stamping trigger: same rules against the default created_at.
      and su.submitted_at <= su.created_at + interval '5 minutes'
      and su.created_at <= su.submitted_at + interval '2 days'
      and char_length(sp.slug) <= 100
      and sp.slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      and (only_users is null or s.user_id = any (only_users))
    order by s.user_id, sp.slug, su.submitted_at
  ), numbered as (
    select
      f.uid, f.problem, f.level,
      row_number() over (
        partition by f.uid, (f.solved_at at time zone 'utc')::date
        order by f.solved_at, f.problem
      ) as nth
    from firsts f
  )
  select n.uid, n.problem, n.level
  from numbered n
  where n.nth <= 30;
$$;

revoke all on function private.leaderboard_solves(timestamptz, timestamptz, uuid[])
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- weekly_leaderboard (0017), now on leaderboard_solves
-- ---------------------------------------------------------------------------
create or replace function public.weekly_leaderboard(week_offset integer default 0)
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
  participant_ids uuid[];
  board jsonb;
begin
  if viewer is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select array_agg(distinct x.id) into participant_ids
  from (
    select viewer as id
    union
    select f.followee_id
    from public.follows f
    where f.follower_id = viewer and f.status = 'accepted'
  ) x;

  with solved as (
    select ls.user_id, ls.slug, ls.difficulty
    from private.leaderboard_solves(from_ts, to_ts, participant_ids) ls
  ), totals as (
    select
      p.id as user_id,
      count(so.slug)::int as total,
      (count(so.slug) filter (where so.difficulty = 'Easy'))::int as easy,
      (count(so.slug) filter (where so.difficulty = 'Medium'))::int as medium,
      (count(so.slug) filter (where so.difficulty = 'Hard'))::int as hard
    from unnest(participant_ids) as p(id)
    left join solved so on so.user_id = p.id
    group by p.id
  ), ranked as (
    select
      t.user_id, t.total, t.easy, t.medium, t.hard,
      pr.handle, pr.display_name, pr.avatar_url,
      (rank() over (order by t.total desc))::int as place
    from totals t
    join public.profiles pr on pr.id = t.user_id
    where pr.handle is not null
  )
  select coalesce(
    jsonb_agg(
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
    ),
    '[]'::jsonb
  ) into board
  from ranked r;

  return jsonb_build_object('week_start', first_day, 'week_end', first_day + 6, 'rows', board);
end $$;

revoke execute on function public.weekly_leaderboard(integer) from public, anon;
grant execute on function public.weekly_leaderboard(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- global_leaderboard (0022), now on leaderboard_solves
-- ---------------------------------------------------------------------------
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
    select ls.user_id, ls.slug, ls.difficulty
    from private.leaderboard_solves(from_ts, to_ts) ls
    join public.profiles pr on pr.id = ls.user_id
    where pr.handle is not null
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
  ), ranked as (
    select t.*, (rank() over (order by t.total desc))::int as place
    from totals t
  ), top as (
    select * from ranked r order by r.place, r.hard desc, r.medium desc, r.handle limit row_limit
  ), me as (
    -- The caller's own standing. No solves this week means no place yet.
    select
      pr.id, pr.handle::text as handle, pr.display_name, pr.avatar_url, pr.is_private,
      coalesce(t.total, 0) as total,
      coalesce(t.easy, 0) as easy,
      coalesce(t.medium, 0) as medium,
      coalesce(t.hard, 0) as hard,
      case
        when coalesce(t.total, 0) = 0 then null
        else 1 + (select count(*) from totals o where o.total > t.total)
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
          'is_viewer', r.user_id = viewer,
          'is_private', r.is_private
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
    'ranked_count', (select count(*)::int from totals)
  ) into result;

  return result;
end $$;

revoke execute on function public.global_leaderboard(integer, integer) from public, anon;
grant execute on function public.global_leaderboard(integer, integer) to authenticated;
