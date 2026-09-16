-- Isolated PostgreSQL fixture, NOT a migration. Run only against an empty disposable database.
--
-- Proves 0019: `show_video` / `show_demo_video` gate `private.can_view_video`, so a clip the
-- author switched off is not reachable by a viewer of the post — the leak being closed is that
-- its Bunny GUID is a permanent link to the file (see docs/privacy.md).
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
create table public.profiles (id uuid primary key, is_private boolean not null default false);
create table public.videos (
  id uuid primary key,
  user_id uuid not null references public.profiles (id),
  bunny_video_id text
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
  show_demo_video boolean not null default true
);
-- Stand-ins for the real rules in 0002: public profiles are visible to everyone, and a post is
-- viewable by its owner or when it is published and public.
create function private.can_view_profile_content(owner uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.profiles p where p.id = owner and not p.is_private)
$$;
create function private.can_view_post(p public.posts) returns boolean language sql stable as $$
  select p.user_id = auth.uid()
    or (p.status = 'published' and p.visibility = 'public'
        and private.can_view_profile_content(p.user_id))
$$;

-- Twice, to prove the migration is idempotent.
\i /migration.sql
\i /migration.sql

insert into profiles (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');
insert into videos (id, user_id, bunny_video_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'guid-shown-main'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a', 'guid-hidden-main'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-00000000000a', 'guid-shown-summary'),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-00000000000a', 'guid-hidden-summary'),
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-00000000000a', 'guid-kind-none');

-- p1: main shown, summary shown       -> both reachable
-- p2: main hidden, summary hidden     -> neither reachable
-- p3: video_kind none, main "shown"   -> not reachable (nothing renders it)
insert into posts (id, user_id, status, visibility, video_id, video_kind, show_video,
                   demo_video_id, show_demo_video) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a', 'published',
   'public', '00000000-0000-0000-0000-0000000000c1', 'full', true,
   '00000000-0000-0000-0000-0000000000c3', true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000a', 'published',
   'public', '00000000-0000-0000-0000-0000000000c2', 'full', false,
   '00000000-0000-0000-0000-0000000000c4', false),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000000a', 'published',
   'public', '00000000-0000-0000-0000-0000000000c5', 'none', true, null, true);

-- A stranger reading the posts.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
begin
  if not private.can_view_video('00000000-0000-0000-0000-0000000000c1') then
    raise exception 'A shown demo video must stay viewable';
  end if;
  if not private.can_view_video('00000000-0000-0000-0000-0000000000c3') then
    raise exception 'A shown summary video must stay viewable';
  end if;
  if private.can_view_video('00000000-0000-0000-0000-0000000000c2') then
    raise exception 'A hidden demo video must not be viewable (its GUID is a permanent link)';
  end if;
  if private.can_view_video('00000000-0000-0000-0000-0000000000c4') then
    raise exception 'A hidden summary video must not be viewable';
  end if;
  if private.can_view_video('00000000-0000-0000-0000-0000000000c5') then
    raise exception 'A video on a video_kind=none post must not be viewable';
  end if;
end $$;

-- The author still sees every clip of their own, hidden or not: the draft editor and the
-- owner's view of the post both depend on it.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
begin
  if not private.can_view_video('00000000-0000-0000-0000-0000000000c2') then
    raise exception 'The owner must still see their own hidden demo video';
  end if;
  if not private.can_view_video('00000000-0000-0000-0000-0000000000c4') then
    raise exception 'The owner must still see their own hidden summary video';
  end if;
end $$;

-- Un-hiding restores access; hiding it again takes it away.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update posts set show_video = true where id = '00000000-0000-0000-0000-0000000000e2';
do $$
begin
  if not private.can_view_video('00000000-0000-0000-0000-0000000000c2') then
    raise exception 'Un-hiding a video must make it viewable again';
  end if;
end $$;
update posts set show_video = false where id = '00000000-0000-0000-0000-0000000000e2';
do $$
begin
  if private.can_view_video('00000000-0000-0000-0000-0000000000c2') then
    raise exception 'Hiding a video again must take access away';
  end if;
end $$;

-- A private post hides its clips from everyone else regardless of the switches.
update posts set visibility = 'private' where id = '00000000-0000-0000-0000-0000000000e1';
do $$
begin
  if private.can_view_video('00000000-0000-0000-0000-0000000000c1') then
    raise exception 'A private post must not expose its shown video';
  end if;
end $$;

select 'hidden_videos fixture passed' as result;
