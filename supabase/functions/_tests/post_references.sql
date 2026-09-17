-- Isolated PostgreSQL fixture, NOT a migration. Run only against an empty disposable database.
--
-- Proves 0020: a post can only reference its author's own session, videos and cover image.
-- The visibility helpers open a session's problems, submissions, transcript, review and videos
-- to whoever can view a post that references them, so a post pointing at somebody else's rows
-- is a read of that user's data.
\set ON_ERROR_STOP on
create role anon;
create role service_role;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.profiles (id uuid primary key);
create table public.sessions (
  id uuid primary key,
  user_id uuid not null references public.profiles (id)
);
create table public.videos (
  id uuid primary key,
  user_id uuid not null references public.profiles (id)
);
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  session_id uuid unique references public.sessions (id) on delete set null,
  video_id uuid references public.videos (id) on delete set null,
  demo_video_id uuid references public.videos (id) on delete set null,
  cover_media_id uuid
);
create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id)
);
alter table public.posts
  add constraint posts_cover_media_id_fkey
  foreign key (cover_media_id) references public.post_media (id) on delete set null;

-- Twice, to prove the migration is idempotent.
\i /migration.sql
\i /migration.sql

insert into profiles (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');
insert into sessions (id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b');
insert into videos (id, user_id) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000b');

-- Own rows: every slot accepted on insert and on update.
insert into posts (id, user_id, session_id, video_id, demo_video_id) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', null);
update posts set demo_video_id = '00000000-0000-0000-0000-0000000000a2', video_id = null
  where id = '00000000-0000-0000-0000-0000000000e1';
insert into post_media (id, post_id, user_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-00000000000a');
update posts set cover_media_id = '00000000-0000-0000-0000-0000000000f1'
  where id = '00000000-0000-0000-0000-0000000000e1';

-- Somebody else's rows: rejected in every slot, on insert and on update.
do $$
declare
  cases text[] := array[
    'insert into posts (user_id, session_id) values (''00000000-0000-0000-0000-00000000000a'', ''00000000-0000-0000-0000-0000000000b1'')',
    'insert into posts (user_id, video_id) values (''00000000-0000-0000-0000-00000000000a'', ''00000000-0000-0000-0000-0000000000b2'')',
    'insert into posts (user_id, demo_video_id) values (''00000000-0000-0000-0000-00000000000a'', ''00000000-0000-0000-0000-0000000000b2'')',
    'update posts set session_id = ''00000000-0000-0000-0000-0000000000b1'' where id = ''00000000-0000-0000-0000-0000000000e1''',
    'update posts set video_id = ''00000000-0000-0000-0000-0000000000b2'' where id = ''00000000-0000-0000-0000-0000000000e1''',
    'update posts set demo_video_id = ''00000000-0000-0000-0000-0000000000b2'' where id = ''00000000-0000-0000-0000-0000000000e1'''
  ];
  stmt text;
  rejected boolean;
begin
  foreach stmt in array cases loop
    rejected := false;
    begin
      execute stmt;
    exception when insufficient_privilege then
      rejected := true;
    end;
    if not rejected then
      raise exception 'Must reject a reference to another user''s row: %', stmt;
    end if;
  end loop;
end $$;

-- A cover image has to belong to the post it decorates.
insert into posts (id, user_id) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000a');
do $$
declare
  rejected boolean := false;
begin
  begin
    update posts set cover_media_id = '00000000-0000-0000-0000-0000000000f1'
      where id = '00000000-0000-0000-0000-0000000000e2';
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Must reject a cover image that belongs to another post';
  end if;
end $$;

-- Detaching (the video-delete function nulls the slot) stays allowed.
update posts set video_id = null, demo_video_id = null, session_id = null
  where id = '00000000-0000-0000-0000-0000000000e1';

select 'post_references fixture passed' as result;
