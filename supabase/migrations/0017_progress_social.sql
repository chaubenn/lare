-- Lare 0017: progress and social.
--
-- Adds
--   * weekly_leaderboard(week_offset) — distinct problems solved this week by the viewer and the
--     people they follow (accepted follows only), ranked.
--   * practice_goals + goal_progress() — one private goal per user ("N problems per day/week,
--     optional minimum difficulty") and how the current and past periods measure up.
--   * notifications — likes, comments, follows, follow requests and accepted follows, written by
--     triggers only, read by their recipient, marked read through mark_notifications_read().
--
-- Days and weeks are UTC and weeks start on Monday, matching solved_activity's UTC buckets.
-- Idempotent: safe to run twice.

-- ---------------------------------------------------------------------------
-- weekly_leaderboard(week_offset) -> { week_start, week_end, rows[] }
-- ---------------------------------------------------------------------------
-- Security definer because `submissions` is owner-only under RLS. The participant set is the
-- viewer plus their accepted followees, which is exactly who `can_view_profile_content` lets the
-- viewer see, so private accounts only appear for approved followers. A problem solved several
-- times in the week counts once. Participants without a handle (not onboarded) are left out.
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
  board jsonb;
begin
  if viewer is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  with participants as (
    select viewer as user_id
    union
    select f.followee_id
    from public.follows f
    where f.follower_id = viewer and f.status = 'accepted'
  ), solved as (
    select distinct on (s.user_id, sp.slug) s.user_id, sp.slug, sp.difficulty
    from public.submissions su
    join public.session_problems sp on sp.id = su.session_problem_id
    join public.sessions s on s.id = sp.session_id
    where s.user_id in (select p.user_id from participants p)
      and su.accepted
      and su.submitted_at >= from_ts
      and su.submitted_at < to_ts
    order by s.user_id, sp.slug, su.submitted_at
  ), totals as (
    select
      p.user_id,
      count(so.slug)::int as total,
      (count(so.slug) filter (where so.difficulty = 'Easy'))::int as easy,
      (count(so.slug) filter (where so.difficulty = 'Medium'))::int as medium,
      (count(so.slug) filter (where so.difficulty = 'Hard'))::int as hard
    from participants p
    left join solved so on so.user_id = p.user_id
    group by p.user_id
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
-- practice_goals
-- ---------------------------------------------------------------------------
create table if not exists public.practice_goals (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  period text not null check (period in ('day', 'week')),
  target integer not null check (target between 1 and 50),
  -- null = any difficulty; otherwise problems at this difficulty or harder
  min_difficulty public.problem_difficulty,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists practice_goals_updated_at on public.practice_goals;
create trigger practice_goals_updated_at before update on public.practice_goals
  for each row execute function private.set_updated_at();

-- Goals are private: only the owner reads or writes their row.
alter table public.practice_goals enable row level security;
drop policy if exists practice_goals_select on public.practice_goals;
create policy practice_goals_select on public.practice_goals for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists practice_goals_insert on public.practice_goals;
create policy practice_goals_insert on public.practice_goals for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists practice_goals_update on public.practice_goals;
create policy practice_goals_update on public.practice_goals for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists practice_goals_delete on public.practice_goals;
create policy practice_goals_delete on public.practice_goals for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- goal_progress() -> the caller's goal measured over the last 60 periods
-- ---------------------------------------------------------------------------
-- The streak counts consecutive met periods ending at the current period; while the current
-- period is still open and unmet it does not break a streak that ran through the previous one.
-- History is measured against the goal as it is now, so editing a goal re-evaluates the streak.
create or replace function public.goal_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  g public.practice_goals%rowtype;
  today date := (now() at time zone 'utc')::date;
  period_days integer;
  current_start date;
  window_start date;
  periods jsonb;
  n_periods integer;
  streak integer := 0;
begin
  if viewer is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into g from public.practice_goals where user_id = viewer;
  if not found then
    return jsonb_build_object('goal', null);
  end if;

  period_days := case g.period when 'day' then 1 else 7 end;
  current_start := case g.period when 'day' then today else date_trunc('week', today)::date end;
  window_start := current_start - period_days * 59;

  with buckets as (
    select window_start + period_days * i as start
    from generate_series(0, 59) as i
  ), solved as (
    select distinct
      window_start
        + period_days * (((su.submitted_at at time zone 'utc')::date - window_start) / period_days) as start,
      sp.slug
    from public.submissions su
    join public.session_problems sp on sp.id = su.session_problem_id
    join public.sessions s on s.id = sp.session_id
    where s.user_id = viewer
      and su.accepted
      and su.submitted_at >= window_start::timestamp at time zone 'utc'
      and (g.min_difficulty is null or sp.difficulty >= g.min_difficulty)
  ), counts as (
    select so.start, count(*)::int as n
    from solved so
    group by so.start
  )
  select jsonb_agg(
    jsonb_build_object('start', b.start, 'count', coalesce(c.n, 0), 'met', coalesce(c.n, 0) >= g.target)
    order by b.start
  ) into periods
  from buckets b
  left join counts c on c.start = b.start;

  n_periods := jsonb_array_length(periods);
  for i in reverse n_periods - 1 .. 0 loop
    if (periods -> i ->> 'met')::boolean then
      streak := streak + 1;
    elsif i < n_periods - 1 then
      exit;
    end if;
  end loop;

  return jsonb_build_object(
    'goal', jsonb_build_object('period', g.period, 'target', g.target, 'min_difficulty', g.min_difficulty),
    'period_start', current_start,
    'period_end', current_start + period_days - 1,
    'current', (periods -> (n_periods - 1) ->> 'count')::int,
    'met', (periods -> (n_periods - 1) ->> 'met')::boolean,
    'streak', streak,
    'history', (
      select jsonb_agg(h.e order by h.ord)
      from jsonb_array_elements(periods) with ordinality as h(e, ord)
      where h.ord > n_periods - 8
    )
  );
end $$;

revoke execute on function public.goal_progress() from public, anon;
grant execute on function public.goal_progress() to authenticated;

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
do $$
begin
  create type public.notification_type as enum
    ('post_like', 'post_comment', 'follow', 'follow_request', 'follow_accepted');
exception when duplicate_object then null;
end $$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  type public.notification_type not null,
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.post_comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (recipient_id <> actor_id)
);
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);
-- A like toggled on and off never stacks up; neither do repeated follow events for one pair.
create unique index if not exists notifications_like_once
  on public.notifications (recipient_id, actor_id, post_id) where type = 'post_like';
create unique index if not exists notifications_follow_once
  on public.notifications (recipient_id, actor_id, type)
  where type in ('follow', 'follow_request', 'follow_accepted');

-- Recipients read their own; nobody writes from a client (triggers and the RPC below do).
alter table public.notifications enable row level security;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));

create or replace function private.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_owner uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.notifications
    where type = 'post_like' and actor_id = old.user_id and post_id = old.post_id;
    return old;
  end if;

  select p.user_id into post_owner from public.posts p where p.id = new.post_id;
  if post_owner is not null and post_owner <> new.user_id then
    insert into public.notifications (recipient_id, actor_id, type, post_id)
    values (post_owner, new.user_id, 'post_like', new.post_id)
    on conflict (recipient_id, actor_id, post_id) where type = 'post_like' do nothing;
  end if;
  return new;
end $$;

drop trigger if exists post_likes_notify on public.post_likes;
create trigger post_likes_notify after insert or delete on public.post_likes
  for each row execute function private.notify_post_like();

-- Deleting a comment removes its notification through the comment_id foreign key.
create or replace function private.notify_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_owner uuid;
begin
  select p.user_id into post_owner from public.posts p where p.id = new.post_id;
  if post_owner is not null and post_owner <> new.user_id then
    insert into public.notifications (recipient_id, actor_id, type, post_id, comment_id)
    values (post_owner, new.user_id, 'post_comment', new.post_id, new.id);
  end if;
  return new;
end $$;

drop trigger if exists post_comments_notify on public.post_comments;
create trigger post_comments_notify after insert on public.post_comments
  for each row execute function private.notify_post_comment();

create or replace function private.notify_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (recipient_id, actor_id, type)
    values (
      new.followee_id,
      new.follower_id,
      case when new.status = 'pending' then 'follow_request' else 'follow' end::public.notification_type
    )
    on conflict (recipient_id, actor_id, type)
      where type in ('follow', 'follow_request', 'follow_accepted') do nothing;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'pending' and new.status = 'accepted' then
      -- The followee just acted on the request; tell the follower instead.
      delete from public.notifications
      where recipient_id = new.followee_id and actor_id = new.follower_id and type = 'follow_request';
      insert into public.notifications (recipient_id, actor_id, type)
      values (new.follower_id, new.followee_id, 'follow_accepted')
      on conflict (recipient_id, actor_id, type)
        where type in ('follow', 'follow_request', 'follow_accepted') do nothing;
    end if;
    return new;
  end if;

  delete from public.notifications
  where (recipient_id = old.followee_id and actor_id = old.follower_id and type in ('follow', 'follow_request'))
     or (recipient_id = old.follower_id and actor_id = old.followee_id and type = 'follow_accepted');
  return old;
end $$;

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert or update or delete on public.follows
  for each row execute function private.notify_follow();

-- mark_notifications_read(ids) -> rows updated; null marks everything the caller has unread.
create or replace function public.mark_notifications_read(ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.notifications
  set read_at = now()
  where recipient_id = auth.uid()
    and read_at is null
    and (ids is null or id = any (ids));
  get diagnostics updated = row_count;
  return updated;
end $$;

revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- Live unread badge on the desktop app. Realtime applies the select policy above.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
