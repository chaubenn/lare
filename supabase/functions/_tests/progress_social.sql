-- Isolated PostgreSQL fixture, NOT a migration. Run only against an empty disposable database.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create schema auth;
create schema private;
create schema extensions;
create extension citext schema extensions;
grant usage on schema auth, public to authenticated;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function private.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create type public.follow_status as enum ('pending', 'accepted');
create type public.problem_difficulty as enum ('Easy', 'Medium', 'Hard');
create table public.profiles (
  id uuid primary key, handle extensions.citext unique, display_name text, avatar_url text,
  is_private boolean not null default false
);
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  status public.follow_status not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id)
);
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade
);
create table public.session_problems (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  slug text not null,
  difficulty public.problem_difficulty
);
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  session_problem_id uuid not null references public.session_problems (id) on delete cascade,
  submitted_at timestamptz not null default now(),
  accepted boolean not null default false
);
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  slug text,
  title text
);
create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (post_id, user_id)
);
create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null
);
create publication supabase_realtime;

\i /migration.sql
\i /migration.sql

-- alice (viewer) · bob (followed) · carol (private, request pending) · dave (stranger)
-- erin, frank (goal users) · a follow target without a handle
insert into profiles (id, handle, is_private) values
  ('00000000-0000-0000-0000-00000000000a', 'alice', false),
  ('00000000-0000-0000-0000-00000000000b', 'bob', false),
  ('00000000-0000-0000-0000-00000000000c', 'carol', true),
  ('00000000-0000-0000-0000-00000000000d', 'dave', false),
  ('00000000-0000-0000-0000-00000000000e', 'erin', false),
  ('00000000-0000-0000-0000-00000000000f', 'frank', false),
  ('00000000-0000-0000-0000-000000000099', null, false);

create function pg_temp.solve(
  who uuid, problem text, diff public.problem_difficulty, at_time timestamptz, ok boolean default true
) returns void language plpgsql as $$
declare sid uuid; pid uuid;
begin
  insert into public.sessions (user_id) values (who) returning id into sid;
  insert into public.session_problems (session_id, slug, difficulty) values (sid, problem, diff) returning id into pid;
  insert into public.submissions (session_problem_id, submitted_at, accepted) values (pid, at_time, ok);
end $$;

create table public.fixture_clock as select
  (date_trunc('week', now() at time zone 'utc') at time zone 'utc') as week_start,
  (date_trunc('day', now() at time zone 'utc') at time zone 'utc') as day_start;

-- ------------------------------------------------------------------ leaderboard
insert into follows (follower_id, followee_id, status) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'accepted'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'pending'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000099', 'accepted');

select pg_temp.solve('00000000-0000-0000-0000-00000000000a', 'two-sum', 'Easy', (select week_start from fixture_clock) + interval '1 hour');
select pg_temp.solve('00000000-0000-0000-0000-00000000000a', 'two-sum', 'Easy', (select week_start from fixture_clock) + interval '2 hours');
select pg_temp.solve('00000000-0000-0000-0000-00000000000a', 'edit-distance', 'Hard', (select week_start from fixture_clock) + interval '3 hours');
select pg_temp.solve('00000000-0000-0000-0000-00000000000a', 'rejected', 'Medium', (select week_start from fixture_clock) + interval '3 hours', false);
select pg_temp.solve('00000000-0000-0000-0000-00000000000b', 'lru-cache', 'Medium', (select week_start from fixture_clock) + interval '1 hour');
select pg_temp.solve('00000000-0000-0000-0000-00000000000b', 'last-week', 'Easy', (select week_start from fixture_clock) - interval '1 day');
select pg_temp.solve('00000000-0000-0000-0000-00000000000c', 'carol-hard', 'Hard', (select week_start from fixture_clock) + interval '1 hour');
select pg_temp.solve('00000000-0000-0000-0000-00000000000d', 'dave-hard', 'Hard', (select week_start from fixture_clock) + interval '1 hour');

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
declare
  board jsonb := public.weekly_leaderboard(0);
  prev jsonb := public.weekly_leaderboard(-1);
  far jsonb := public.weekly_leaderboard(-500);
begin
  if jsonb_array_length(board -> 'rows') <> 2 then
    raise exception 'Only the viewer and accepted followees with handles: %', board;
  end if;
  if board -> 'rows' -> 0 ->> 'handle' <> 'alice'
     or (board -> 'rows' -> 0 ->> 'total')::int <> 2
     or (board -> 'rows' -> 0 ->> 'easy')::int <> 1
     or (board -> 'rows' -> 0 ->> 'hard')::int <> 1
     or (board -> 'rows' -> 0 ->> 'rank')::int <> 1
     or not (board -> 'rows' -> 0 ->> 'is_viewer')::boolean then
    raise exception 'Viewer row wrong (distinct slugs, accepted only): %', board -> 'rows' -> 0;
  end if;
  if board -> 'rows' -> 1 ->> 'handle' <> 'bob'
     or (board -> 'rows' -> 1 ->> 'total')::int <> 1
     or (board -> 'rows' -> 1 ->> 'rank')::int <> 2 then
    raise exception 'Followee row wrong (week bounds): %', board -> 'rows' -> 1;
  end if;
  if (board ->> 'week_start')::date <> (select week_start from fixture_clock)::date
     or (board ->> 'week_end')::date <> (select week_start from fixture_clock)::date + 6 then
    raise exception 'Week bounds wrong: %', board;
  end if;
  if prev -> 'rows' -> 0 ->> 'handle' <> 'bob'
     or (prev -> 'rows' -> 0 ->> 'total')::int <> 1
     or (prev -> 'rows' -> 1 ->> 'total')::int <> 0
     or (prev -> 'rows' -> 1 ->> 'rank')::int <> 2 then
    raise exception 'Last week wrong: %', prev;
  end if;
  if (far ->> 'week_start')::date <> (select week_start from fixture_clock)::date - 364 then
    raise exception 'week_offset must clamp to -52: %', far;
  end if;
  if has_function_privilege('anon', 'public.weekly_leaderboard(integer)', 'execute') then
    raise exception 'Anon must not read the leaderboard';
  end if;
end $$;

-- ------------------------------------------------------------------ goals
select pg_temp.solve('00000000-0000-0000-0000-00000000000e', 'hard-today', 'Hard', (select day_start from fixture_clock) + interval '1 second');
select pg_temp.solve('00000000-0000-0000-0000-00000000000e', 'easy-today', 'Easy', (select day_start from fixture_clock) + interval '2 seconds');
select pg_temp.solve('00000000-0000-0000-0000-00000000000e', 'medium-yesterday', 'Medium', (select day_start from fixture_clock) - interval '12 hours');
select pg_temp.solve('00000000-0000-0000-0000-00000000000f', 'frank-yesterday', 'Medium', (select day_start from fixture_clock) - interval '12 hours');

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$
declare p jsonb;
begin
  if public.goal_progress() <> '{"goal": null}'::jsonb then
    raise exception 'No goal must return {"goal": null}: %', public.goal_progress();
  end if;

  insert into practice_goals (user_id, period, target, min_difficulty)
  values ('00000000-0000-0000-0000-00000000000e', 'day', 1, 'Medium');
  p := public.goal_progress();
  if (p ->> 'current')::int <> 1 or not (p ->> 'met')::boolean or (p ->> 'streak')::int <> 2 then
    raise exception 'Daily Medium+ goal wrong (min difficulty, streak through today): %', p;
  end if;
  if jsonb_array_length(p -> 'history') <> 8 or (p -> 'history' -> 7 ->> 'count')::int <> 1 then
    raise exception 'History must be the last 8 periods, newest last: %', p;
  end if;
  if p -> 'goal' ->> 'min_difficulty' <> 'Medium'
     or (p ->> 'period_start')::date <> (select day_start from fixture_clock)::date
     or (p ->> 'period_end')::date <> (select day_start from fixture_clock)::date then
    raise exception 'Goal echo or period bounds wrong: %', p;
  end if;

  update practice_goals set target = 2 where user_id = '00000000-0000-0000-0000-00000000000e';
  p := public.goal_progress();
  if (p ->> 'met')::boolean or (p ->> 'streak')::int <> 0 then
    raise exception 'Editing the goal must re-evaluate the streak: %', p;
  end if;

  update practice_goals set period = 'week', target = 2, min_difficulty = null
  where user_id = '00000000-0000-0000-0000-00000000000e';
  p := public.goal_progress();
  if (p ->> 'current')::int < 2 or not (p ->> 'met')::boolean or (p ->> 'streak')::int < 1
     or (p ->> 'period_end')::date <> (p ->> 'period_start')::date + 6 then
    raise exception 'Weekly goal wrong: %', p;
  end if;

  begin
    insert into practice_goals (user_id, period, target)
    values ('00000000-0000-0000-0000-00000000000d', 'day', 51);
    raise exception 'Target above 50 accepted';
  exception when check_violation then null;
  end;
  if has_function_privilege('anon', 'public.goal_progress()', 'execute') then
    raise exception 'Anon must not read goal progress';
  end if;
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
insert into practice_goals (user_id, period, target) values ('00000000-0000-0000-0000-00000000000f', 'day', 1);
do $$
declare p jsonb := public.goal_progress();
begin
  if (p ->> 'current')::int <> 0 or (p ->> 'met')::boolean or (p ->> 'streak')::int <> 1 then
    raise exception 'An open, unmet period must not break the streak: %', p;
  end if;
end $$;

-- ------------------------------------------------------------------ notifications
insert into posts (id, user_id, slug, title) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'a-post', 'Alice post'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'b-post', 'Bob post');
insert into post_likes (post_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a');
insert into post_comments (id, post_id, user_id, body) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', 'nice'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'thanks');
insert into follows (follower_id, followee_id, status) values
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000a', 'accepted');

do $$
begin
  if (select count(*) from notifications where recipient_id = '00000000-0000-0000-0000-00000000000a') <> 3 then
    raise exception 'alice needs a like, a comment and a follow: %',
      (select jsonb_agg(to_jsonb(n)) from notifications n where recipient_id = '00000000-0000-0000-0000-00000000000a');
  end if;
  if not exists (select 1 from notifications where recipient_id = '00000000-0000-0000-0000-00000000000a'
                 and type = 'post_comment' and comment_id = '00000000-0000-0000-0000-0000000000c1') then
    raise exception 'Comment notification must carry comment_id';
  end if;
  if (select count(*) from notifications where recipient_id = '00000000-0000-0000-0000-00000000000c'
      and actor_id = '00000000-0000-0000-0000-00000000000a' and type = 'follow_request') <> 1 then
    raise exception 'Pending follow must notify followee with follow_request';
  end if;
  if (select count(*) from notifications where recipient_id = '00000000-0000-0000-0000-00000000000b'
      and actor_id = '00000000-0000-0000-0000-00000000000a' and type = 'follow') <> 1 then
    raise exception 'Accepted follow must notify followee with follow';
  end if;
end $$;

delete from post_likes where post_id = '00000000-0000-0000-0000-0000000000a1' and user_id = '00000000-0000-0000-0000-00000000000b';
delete from post_comments where id = '00000000-0000-0000-0000-0000000000c1';
update follows set status = 'accepted'
where follower_id = '00000000-0000-0000-0000-00000000000a' and followee_id = '00000000-0000-0000-0000-00000000000c';
-- request_follow's upsert re-applying the same status must not duplicate anything
insert into follows (follower_id, followee_id, status) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'accepted')
on conflict (follower_id, followee_id) do update set status = greatest(public.follows.status, excluded.status);

do $$
begin
  if exists (select 1 from notifications where recipient_id = '00000000-0000-0000-0000-00000000000a'
             and type in ('post_like', 'post_comment')) then
    raise exception 'Unlike and comment delete must remove their notifications';
  end if;
  if exists (select 1 from notifications where recipient_id = '00000000-0000-0000-0000-00000000000c'
             and type = 'follow_request') then
    raise exception 'Accepting must remove the follow_request';
  end if;
  if (select count(*) from notifications where recipient_id = '00000000-0000-0000-0000-00000000000a'
      and actor_id = '00000000-0000-0000-0000-00000000000c' and type = 'follow_accepted') <> 1 then
    raise exception 'Accepting must notify the follower exactly once';
  end if;
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
declare n integer;
begin
  n := public.mark_notifications_read(null);
  if n <> 2 then
    raise exception 'alice should have had 2 unread (follow, follow_accepted), got %', n;
  end if;
  if exists (select 1 from notifications where recipient_id = '00000000-0000-0000-0000-00000000000a' and read_at is null) then
    raise exception 'mark_notifications_read(null) must mark all';
  end if;
  if exists (select 1 from notifications where recipient_id <> '00000000-0000-0000-0000-00000000000a' and read_at is not null) then
    raise exception 'mark_notifications_read must only touch the caller''s rows';
  end if;
  if has_function_privilege('anon', 'public.mark_notifications_read(uuid[])', 'execute') then
    raise exception 'Anon must not mark notifications';
  end if;
end $$;

grant select on public.notifications to authenticated;
set role authenticated;
do $$
begin
  if (select count(*) from public.notifications) <> 2 then
    raise exception 'RLS must show alice only her own notifications';
  end if;
end $$;
reset role;

delete from follows where follower_id = '00000000-0000-0000-0000-00000000000a' and followee_id = '00000000-0000-0000-0000-00000000000c';
do $$
begin
  if exists (select 1 from notifications where recipient_id = '00000000-0000-0000-0000-00000000000a'
             and actor_id = '00000000-0000-0000-0000-00000000000c') then
    raise exception 'Unfollow must remove follow_accepted';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') then
    raise exception 'notifications must be in the realtime publication';
  end if;
end $$;

select 'progress_social fixture passed' as result;
