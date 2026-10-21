-- Isolated PostgreSQL fixture for 0022_global_leaderboard.sql, NOT a migration. Run only against
-- an empty disposable database; mount the migration at /migration.sql (see docs/qa.md).
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create schema auth;
create schema extensions;
create extension citext schema extensions;
grant usage on schema auth, public to authenticated;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create type public.problem_difficulty as enum ('Easy', 'Medium', 'Hard');
create table public.profiles (
  id uuid primary key, handle extensions.citext unique, display_name text, avatar_url text,
  is_private boolean not null default false
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

\i /migration.sql
\i /migration.sql

-- alice, bob, dave: public · carol: private · erin: public, never solves · a user with no handle
insert into profiles (id, handle, is_private) values
  ('00000000-0000-0000-0000-00000000000a', 'alice', false),
  ('00000000-0000-0000-0000-00000000000b', 'bob', false),
  ('00000000-0000-0000-0000-00000000000c', 'carol', true),
  ('00000000-0000-0000-0000-00000000000d', 'dave', false),
  ('00000000-0000-0000-0000-00000000000e', 'erin', false),
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
  (date_trunc('week', now() at time zone 'utc') at time zone 'utc') as week_start;

select pg_temp.solve('00000000-0000-0000-0000-00000000000a', 'two-sum', 'Easy', (select week_start from fixture_clock) + interval '1 hour');
select pg_temp.solve('00000000-0000-0000-0000-00000000000a', 'two-sum', 'Easy', (select week_start from fixture_clock) + interval '2 hours');
select pg_temp.solve('00000000-0000-0000-0000-00000000000a', 'edit-distance', 'Hard', (select week_start from fixture_clock) + interval '3 hours');
select pg_temp.solve('00000000-0000-0000-0000-00000000000a', 'rejected', 'Medium', (select week_start from fixture_clock) + interval '3 hours', false);
select pg_temp.solve('00000000-0000-0000-0000-00000000000b', 'lru-cache', 'Medium', (select week_start from fixture_clock) + interval '1 hour');
select pg_temp.solve('00000000-0000-0000-0000-00000000000b', 'last-week', 'Easy', (select week_start from fixture_clock) - interval '1 day');
select pg_temp.solve('00000000-0000-0000-0000-00000000000c', 'carol-hard', 'Hard', (select week_start from fixture_clock) + interval '1 hour');
select pg_temp.solve('00000000-0000-0000-0000-00000000000d', 'dave-hard', 'Hard', (select week_start from fixture_clock) + interval '1 hour');

-- A public viewer sees the public board with their own place in it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
declare board jsonb := public.global_leaderboard(0);
begin
  if jsonb_array_length(board -> 'rows') <> 3 then
    raise exception 'Public accounts only (alice, bob, dave; carol is private, erin solved nothing): %', board;
  end if;
  if board -> 'rows' -> 0 ->> 'handle' <> 'alice'
     or (board -> 'rows' -> 0 ->> 'total')::int <> 2
     or (board -> 'rows' -> 0 ->> 'easy')::int <> 1
     or (board -> 'rows' -> 0 ->> 'hard')::int <> 1
     or (board -> 'rows' -> 0 ->> 'rank')::int <> 1
     or not (board -> 'rows' -> 0 ->> 'is_viewer')::boolean then
    raise exception 'Viewer row wrong (distinct slugs, accepted only): %', board -> 'rows' -> 0;
  end if;
  if board -> 'rows' -> 1 ->> 'handle' <> 'dave'
     or board -> 'rows' -> 2 ->> 'handle' <> 'bob'
     or (board -> 'rows' -> 1 ->> 'rank')::int <> 2
     or (board -> 'rows' -> 2 ->> 'rank')::int <> 2 then
    raise exception 'Ties share a rank and break on harder problems first: %', board -> 'rows';
  end if;
  if (board -> 'viewer' ->> 'rank')::int <> 1 or (board -> 'viewer' ->> 'is_private')::boolean then
    raise exception 'Public viewer standing wrong: %', board -> 'viewer';
  end if;
  if (board ->> 'ranked_count')::int <> 3 then
    raise exception 'ranked_count must count public solvers: %', board;
  end if;
  if (board ->> 'week_start')::date <> (select week_start from fixture_clock)::date
     or (board ->> 'week_end')::date <> (select week_start from fixture_clock)::date + 6 then
    raise exception 'Week bounds wrong: %', board;
  end if;
end $$;

-- A private viewer sees where they stand, but is not on the board anyone else reads.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$
declare board jsonb := public.global_leaderboard(0);
begin
  if board -> 'rows' @> '[{"handle": "carol"}]'::jsonb then
    raise exception 'A private account must not be in rows, even for itself: %', board -> 'rows';
  end if;
  if jsonb_array_length(board -> 'rows') <> 3 or (board ->> 'ranked_count')::int <> 3 then
    raise exception 'A private viewer must not change the public board: %', board;
  end if;
  if board -> 'rows' -> 1 ->> 'handle' <> 'dave' or (board -> 'rows' -> 1 ->> 'rank')::int <> 2 then
    raise exception 'A private viewer must not move anyone elses place: %', board -> 'rows';
  end if;
  if board -> 'viewer' ->> 'handle' <> 'carol'
     or not (board -> 'viewer' ->> 'is_private')::boolean
     or (board -> 'viewer' ->> 'total')::int <> 1
     or (board -> 'viewer' ->> 'hard')::int <> 1
     or (board -> 'viewer' ->> 'rank')::int <> 2 then
    raise exception 'Private viewer must see their own standing (tied with bob and dave): %', board -> 'viewer';
  end if;
end $$;

-- Nobody else ever sees the private account, and it never changes a public caller's board.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$
declare board jsonb := public.global_leaderboard(0);
begin
  if board -> 'rows' @> '[{"handle": "carol"}]'::jsonb or board::text like '%00000000-0000-0000-0000-00000000000c%' then
    raise exception 'A private account leaked into another viewers board: %', board;
  end if;
end $$;

-- No solves this week: still shown, but without a place. No handle: nothing to show.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$
declare board jsonb := public.global_leaderboard(0);
begin
  if board -> 'viewer' ->> 'handle' <> 'erin'
     or (board -> 'viewer' ->> 'total')::int <> 0
     or board -> 'viewer' -> 'rank' <> 'null'::jsonb then
    raise exception 'A viewer with no solves has a standing but no rank: %', board -> 'viewer';
  end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000099';
do $$
begin
  if public.global_leaderboard(0) -> 'viewer' <> 'null'::jsonb then
    raise exception 'A viewer without a handle has no standing: %', public.global_leaderboard(0);
  end if;
end $$;

-- Past weeks, row cap, week clamp and access.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
declare
  prev jsonb := public.global_leaderboard(-1);
  capped jsonb := public.global_leaderboard(0, 1);
  far jsonb := public.global_leaderboard(-500);
begin
  if jsonb_array_length(prev -> 'rows') <> 1 or prev -> 'rows' -> 0 ->> 'handle' <> 'bob' then
    raise exception 'Last week wrong: %', prev;
  end if;
  if (prev -> 'viewer' ->> 'total')::int <> 0 or prev -> 'viewer' -> 'rank' <> 'null'::jsonb then
    raise exception 'Alice solved nothing last week: %', prev -> 'viewer';
  end if;
  if jsonb_array_length(capped -> 'rows') <> 1 or (capped ->> 'ranked_count')::int <> 3 then
    raise exception 'max_rows caps rows but not ranked_count: %', capped;
  end if;
  if (far ->> 'week_start')::date <> (select week_start from fixture_clock)::date - 364 then
    raise exception 'week_offset must clamp to -52: %', far;
  end if;
  if has_function_privilege('anon', 'public.global_leaderboard(integer, integer)', 'execute') then
    raise exception 'Anon must not read the leaderboard';
  end if;
end $$;
reset request.jwt.claim.sub;
do $$
begin
  begin
    perform public.global_leaderboard(0);
    raise exception 'Unauthenticated callers must be rejected';
  exception when sqlstate '28000' then null;
  end;
end $$;

\echo global_leaderboard fixture passed
