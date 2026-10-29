-- Isolated PostgreSQL fixture, NOT a migration. Run only against an empty disposable database.
\set ON_ERROR_STOP on
create role anon;
create role service_role;
create role authenticated;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create type public.post_status as enum ('draft', 'published');
create type public.post_visibility as enum ('public', 'private');
create type public.video_kind as enum ('none', 'full', 'highlights');
create type public.video_status as enum ('created', 'uploading', 'uploaded', 'processing', 'ready', 'failed');
create table public.profiles (id uuid primary key, is_private boolean not null default false);
create table public.videos (
  id uuid primary key,
  user_id uuid not null references public.profiles (id),
  status public.video_status not null default 'created'
);
create table public.posts (
  id uuid primary key,
  user_id uuid not null references public.profiles (id),
  status public.post_status not null default 'draft',
  visibility public.post_visibility not null default 'public',
  video_id uuid references public.videos (id),
  video_kind public.video_kind not null default 'none',
  show_video boolean not null default true,
  demo_video_id uuid references public.videos (id),
  show_demo_video boolean not null default true,
  published_at timestamptz
);
-- Stand-in for the real rule in 0002: public profiles are visible to everyone.
create function private.can_view_profile_content(owner uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.profiles p where p.id = owner and not p.is_private)
$$;

\i /migration.sql
\i /migration.sql

insert into profiles (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');
insert into videos (id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'processing'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a', 'processing'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-00000000000a', 'processing'),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-00000000000a', 'uploading'),
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-00000000000a', 'processing');

-- p1: main video processing, shown           -> pending
-- p2: main video processing, hidden          -> live
-- p3: summary video processing, shown        -> pending
-- p4: video_kind none with a processing video -> live
-- p5: draft with a video                     -> never visible to others
insert into posts (id, user_id, status, video_id, video_kind, show_video, demo_video_id, show_demo_video, published_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a', 'published', '00000000-0000-0000-0000-0000000000c1', 'full', true, null, true, '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000a', 'published', '00000000-0000-0000-0000-0000000000c2', 'full', false, null, true, '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000000a', 'published', null, 'none', true, '00000000-0000-0000-0000-0000000000c3', true, '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000000a', 'published', '00000000-0000-0000-0000-0000000000c4', 'none', true, null, true, '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000000a', 'draft', '00000000-0000-0000-0000-0000000000c5', 'full', true, null, true, null);

create function pg_temp.visible(post uuid) returns boolean language sql as $$
  select private.can_view_post(p) from public.posts p where p.id = post
$$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
begin
  if pg_temp.visible('00000000-0000-0000-0000-0000000000e1') then
    raise exception 'A post whose shown video is processing must be hidden from others';
  end if;
  if not pg_temp.visible('00000000-0000-0000-0000-0000000000e2') then
    raise exception 'A hidden video must not hold its post back';
  end if;
  if pg_temp.visible('00000000-0000-0000-0000-0000000000e3') then
    raise exception 'A processing summary video must hold its post back';
  end if;
  if not pg_temp.visible('00000000-0000-0000-0000-0000000000e4') then
    raise exception 'video_kind none must not wait on video_id';
  end if;
  if pg_temp.visible('00000000-0000-0000-0000-0000000000e5') then
    raise exception 'Drafts stay private';
  end if;
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
begin
  if not pg_temp.visible('00000000-0000-0000-0000-0000000000e1') or not pg_temp.visible('00000000-0000-0000-0000-0000000000e3') then
    raise exception 'The author always sees their own pending posts';
  end if;
end $$;

-- The last shown video becoming ready publishes the post now.
update videos set status = 'ready' where id = '00000000-0000-0000-0000-0000000000c1';
-- A hidden video becoming ready changes nothing about when its post went live.
update videos set status = 'ready' where id = '00000000-0000-0000-0000-0000000000c2';
-- A draft's video becoming ready does not publish it.
update videos set status = 'ready' where id = '00000000-0000-0000-0000-0000000000c5';

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
begin
  if not pg_temp.visible('00000000-0000-0000-0000-0000000000e1') then
    raise exception 'The post must be visible once its video is ready';
  end if;
  if (select published_at from posts where id = '00000000-0000-0000-0000-0000000000e1') < now() - interval '1 minute' then
    raise exception 'Going live must bump published_at to the top of feeds';
  end if;
  if (select published_at from posts where id = '00000000-0000-0000-0000-0000000000e2') <> '2026-01-01'::timestamptz then
    raise exception 'A hidden video turning ready must not bump its post';
  end if;
  if (select published_at from posts where id = '00000000-0000-0000-0000-0000000000e5') is not null then
    raise exception 'A draft must not be published by its video turning ready';
  end if;
end $$;

-- Swapping an unready video onto a live post makes it pending again, until that one is ready.
update posts set video_id = '00000000-0000-0000-0000-0000000000c4', published_at = '2026-01-02'
where id = '00000000-0000-0000-0000-0000000000e1';
do $$
begin
  if pg_temp.visible('00000000-0000-0000-0000-0000000000e1') then
    raise exception 'A swapped-in unready video must make the post pending again';
  end if;
end $$;
update videos set status = 'failed' where id = '00000000-0000-0000-0000-0000000000c4';
do $$
begin
  if pg_temp.visible('00000000-0000-0000-0000-0000000000e1') then
    raise exception 'A failed video keeps its post pending';
  end if;
end $$;
update videos set status = 'ready' where id = '00000000-0000-0000-0000-0000000000c4';
do $$
begin
  if not pg_temp.visible('00000000-0000-0000-0000-0000000000e1') then
    raise exception 'The post must go live again once the new video is ready';
  end if;
  if (select published_at from posts where id = '00000000-0000-0000-0000-0000000000e1') <= '2026-01-02'::timestamptz then
    raise exception 'Going live again must bump published_at';
  end if;
end $$;

select 'pending_posts fixture passed' as result;
