-- Lare: initial schema. Applied to project jndqrvwkwoyvzoqcveev via the Supabase MCP.
-- Conventions: every table has RLS enabled; visibility logic lives in security-definer
-- helper functions so policies stay short and never recurse.

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.post_visibility as enum ('public', 'private');
create type public.post_status as enum ('draft', 'published');
create type public.video_kind as enum ('none', 'full', 'highlights');
create type public.session_kind as enum ('practice', 'interview');
create type public.session_scope as enum ('session', 'problem');
create type public.session_status as enum ('active', 'paused', 'ended', 'abandoned');
create type public.session_event_type as enum ('start', 'pause', 'resume', 'end', 'problem_open', 'problem_close');
create type public.video_mode as enum ('instant', 'studio');
create type public.video_status as enum ('created', 'uploading', 'uploaded', 'processing', 'ready', 'failed');
create type public.follow_status as enum ('pending', 'accepted');
create type public.problem_difficulty as enum ('Easy', 'Medium', 'Hard');

-- ---------------------------------------------------------------------------
-- Utility: updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle extensions.citext unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) <= 60),
  avatar_url text,
  bio text check (char_length(bio) <= 280),
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'user_name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Follows (private accounts: pending until accepted; public accounts: auto-accepted)
-- ---------------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  status public.follow_status not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_status_idx on public.follows (followee_id, status);
create index follows_follower_status_idx on public.follows (follower_id, status);

-- ---------------------------------------------------------------------------
-- Sessions (timer is derived from session_events, never from a running interval)
-- ---------------------------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.session_kind not null default 'practice',
  scope public.session_scope not null default 'problem',
  status public.session_status not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  active_ms integer not null default 0 check (active_ms >= 0),
  recording_id text,
  client text, -- e.g. "extension/0.1.0"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessions_user_started_idx on public.sessions (user_id, started_at desc);
create trigger sessions_updated_at before update on public.sessions
  for each row execute function public.set_updated_at();

create table public.session_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions (id) on delete cascade,
  t timestamptz not null default now(),
  type public.session_event_type not null,
  payload jsonb not null default '{}'::jsonb
);
create index session_events_session_t_idx on public.session_events (session_id, t);

create table public.session_problems (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  slug text not null,
  frontend_id text,
  title text not null,
  difficulty public.problem_difficulty,
  url text not null,
  description_html text,
  topic_tags jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  active_ms integer not null default 0 check (active_ms >= 0),
  edits_path text, -- storage object path in bucket session-data
  created_at timestamptz not null default now()
);
create index session_problems_session_idx on public.session_problems (session_id, opened_at);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  session_problem_id uuid not null references public.session_problems (id) on delete cascade,
  leetcode_submission_id bigint,
  submitted_at timestamptz not null default now(),
  lang text,
  lang_verbose text,
  code text,
  status_display text,
  status_code integer,
  accepted boolean not null default false,
  runtime_ms integer,
  runtime_display text,
  runtime_percentile double precision,
  memory_mb double precision,
  memory_display text,
  memory_percentile double precision,
  runtime_distribution jsonb,
  memory_distribution jsonb,
  total_correct integer,
  total_testcases integer,
  created_at timestamptz not null default now(),
  unique (session_problem_id, leetcode_submission_id)
);
create index submissions_problem_idx on public.submissions (session_problem_id, submitted_at);

-- ---------------------------------------------------------------------------
-- Videos (Bunny Stream) and posts
-- ---------------------------------------------------------------------------
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  bunny_video_id uuid unique,
  library_id bigint not null,
  mode public.video_mode not null default 'instant',
  status public.video_status not null default 'created',
  duration_ms integer,
  width integer,
  height integer,
  thumbnail_path text, -- storage object path in bucket thumbnails
  size_bytes bigint,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz
);
create index videos_user_idx on public.videos (user_id, created_at desc);
create trigger videos_updated_at before update on public.videos
  for each row execute function public.set_updated_at();

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid unique references public.sessions (id) on delete set null,
  status public.post_status not null default 'draft',
  visibility public.post_visibility not null default 'public',
  title text check (char_length(title) <= 140),
  body text check (char_length(body) <= 5000),
  video_id uuid references public.videos (id) on delete set null,
  video_kind public.video_kind not null default 'none',
  include_ai_insights boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index posts_user_published_idx on public.posts (user_id, published_at desc);
create index posts_published_idx on public.posts (status, published_at desc);
create trigger posts_updated_at before update on public.posts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Interview artefacts
-- ---------------------------------------------------------------------------
create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions (id) on delete cascade,
  model text not null,
  language text not null default 'en',
  segments jsonb not null default '[]'::jsonb, -- [{s: startMs, e: endMs, text}]
  created_at timestamptz not null default now()
);

create table public.interview_reviews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions (id) on delete cascade,
  model text not null,
  overall integer check (overall between 0 and 100),
  scores jsonb not null default '{}'::jsonb,
  summary text,
  moments jsonb not null default '[]'::jsonb,
  code_iterations jsonb not null default '[]'::jsonb,
  next_steps jsonb not null default '[]'::jsonb,
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Visibility helpers (security definer => bypass RLS, no policy recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_accepted_follower(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.follows f
    where f.followee_id = target and f.follower_id = auth.uid() and f.status = 'accepted'
  );
$$;

-- Content of a public account is visible to everyone (including anonymous viewers);
-- content of a private account only to the owner and accepted followers.
create or replace function public.can_view_profile_content(owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select owner = auth.uid()
    or not exists (select 1 from public.profiles p where p.id = owner and p.is_private)
    or public.is_accepted_follower(owner);
$$;

create or replace function public.can_view_post(p public.posts)
returns boolean language sql stable security definer set search_path = public as $$
  select p.user_id = auth.uid()
    or (p.status = 'published' and p.visibility = 'public' and public.can_view_profile_content(p.user_id));
$$;

create or replace function public.can_view_session(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions s where s.id = sid and s.user_id = auth.uid())
    or exists (select 1 from public.posts p where p.session_id = sid and public.can_view_post(p));
$$;

create or replace function public.can_view_session_insights(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions s where s.id = sid and s.user_id = auth.uid())
    or exists (
      select 1 from public.posts p
      where p.session_id = sid and p.include_ai_insights and public.can_view_post(p)
    );
$$;

create or replace function public.owns_session(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions s where s.id = sid and s.user_id = auth.uid());
$$;

create or replace function public.owns_session_problem(spid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.session_problems sp
    join public.sessions s on s.id = sp.session_id
    where sp.id = spid and s.user_id = auth.uid()
  );
$$;

create or replace function public.can_view_session_problem(spid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.session_problems sp
    where sp.id = spid and public.can_view_session(sp.session_id)
  );
$$;

create or replace function public.can_view_video(vid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.videos v where v.id = vid and v.user_id = auth.uid())
    or exists (select 1 from public.posts p where p.video_id = vid and public.can_view_post(p));
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.sessions enable row level security;
alter table public.session_events enable row level security;
alter table public.session_problems enable row level security;
alter table public.submissions enable row level security;
alter table public.videos enable row level security;
alter table public.posts enable row level security;
alter table public.transcripts enable row level security;
alter table public.interview_reviews enable row level security;

-- profiles: public directory (handle, name, avatar, privacy flag); owner edits.
create policy profiles_select on public.profiles for select using (true);
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- follows: parties see their own edges; writes go through RPCs or owner-scoped statements.
create policy follows_select on public.follows for select
  using (follower_id = auth.uid() or followee_id = auth.uid());
create policy follows_update_accept on public.follows for update
  using (followee_id = auth.uid()) with check (followee_id = auth.uid());
create policy follows_delete on public.follows for delete
  using (follower_id = auth.uid() or followee_id = auth.uid());

-- sessions
create policy sessions_select on public.sessions for select
  using (user_id = auth.uid() or public.can_view_session(id));
create policy sessions_insert on public.sessions for insert with check (user_id = auth.uid());
create policy sessions_update on public.sessions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sessions_delete on public.sessions for delete using (user_id = auth.uid());

-- session_events: owner only
create policy session_events_select on public.session_events for select using (public.owns_session(session_id));
create policy session_events_insert on public.session_events for insert with check (public.owns_session(session_id));
create policy session_events_delete on public.session_events for delete using (public.owns_session(session_id));

-- session_problems
create policy session_problems_select on public.session_problems for select using (public.can_view_session(session_id));
create policy session_problems_insert on public.session_problems for insert with check (public.owns_session(session_id));
create policy session_problems_update on public.session_problems for update using (public.owns_session(session_id)) with check (public.owns_session(session_id));
create policy session_problems_delete on public.session_problems for delete using (public.owns_session(session_id));

-- submissions
create policy submissions_select on public.submissions for select using (public.can_view_session_problem(session_problem_id));
create policy submissions_insert on public.submissions for insert with check (public.owns_session_problem(session_problem_id));
create policy submissions_update on public.submissions for update using (public.owns_session_problem(session_problem_id)) with check (public.owns_session_problem(session_problem_id));
create policy submissions_delete on public.submissions for delete using (public.owns_session_problem(session_problem_id));

-- videos
create policy videos_select on public.videos for select using (user_id = auth.uid() or public.can_view_video(id));
create policy videos_insert on public.videos for insert with check (user_id = auth.uid());
create policy videos_update on public.videos for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy videos_delete on public.videos for delete using (user_id = auth.uid());

-- posts
create policy posts_select on public.posts for select using (public.can_view_post(posts));
create policy posts_insert on public.posts for insert with check (user_id = auth.uid());
create policy posts_update on public.posts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy posts_delete on public.posts for delete using (user_id = auth.uid());

-- transcripts and reviews: owner, or viewers of a post that includes AI insights
create policy transcripts_select on public.transcripts for select using (public.can_view_session_insights(session_id));
create policy transcripts_insert on public.transcripts for insert with check (public.owns_session(session_id));
create policy transcripts_update on public.transcripts for update using (public.owns_session(session_id)) with check (public.owns_session(session_id));
create policy transcripts_delete on public.transcripts for delete using (public.owns_session(session_id));

create policy interview_reviews_select on public.interview_reviews for select using (public.can_view_session_insights(session_id));
create policy interview_reviews_delete on public.interview_reviews for delete using (public.owns_session(session_id));
-- inserts/updates happen from the ai-review Edge Function with the service role.

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- Follow (or request to follow) a profile by handle. Auto-accepts for public accounts.
create or replace function public.request_follow(target_handle extensions.citext)
returns public.follow_status language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
  new_status public.follow_status;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into target from public.profiles where handle = target_handle;
  if target.id is null then raise exception 'profile not found'; end if;
  if target.id = auth.uid() then raise exception 'cannot follow yourself'; end if;
  new_status := case when target.is_private then 'pending' else 'accepted' end;
  insert into public.follows (follower_id, followee_id, status)
  values (auth.uid(), target.id, new_status)
  on conflict (follower_id, followee_id) do update set status = greatest(public.follows.status, excluded.status);
  return (select status from public.follows where follower_id = auth.uid() and followee_id = target.id);
end $$;

create or replace function public.accept_follow(follower uuid)
returns void language sql security definer set search_path = public as $$
  update public.follows set status = 'accepted'
  where followee_id = auth.uid() and follower_id = follower and status = 'pending';
$$;

create or replace function public.decline_follow(follower uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.follows where followee_id = auth.uid() and follower_id = follower;
$$;

-- Feed: own posts + published posts of accepted followees, newest first, cursor by published_at.
create or replace function public.feed(before timestamptz default null, page_size integer default 20)
returns setof public.posts language sql stable security invoker set search_path = public as $$
  select p.* from public.posts p
  where p.status = 'published'
    and (before is null or p.published_at < before)
    and (
      p.user_id = auth.uid()
      or (p.visibility = 'public' and p.user_id in (
        select f.followee_id from public.follows f where f.follower_id = auth.uid() and f.status = 'accepted'
      ))
    )
  order by p.published_at desc
  limit least(greatest(page_size, 1), 50);
$$;

-- Profile stats respecting privacy (private + not follower => only follower counts).
create or replace function public.profile_stats(target_handle extensions.citext)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
  visible boolean;
  result jsonb;
begin
  select * into target from public.profiles where handle = target_handle;
  if target.id is null then return null; end if;
  visible := public.can_view_profile_content(target.id);
  result := jsonb_build_object(
    'followers', (select count(*) from public.follows where followee_id = target.id and status = 'accepted'),
    'following', (select count(*) from public.follows where follower_id = target.id and status = 'accepted'),
    'visible', visible
  );
  if visible then
    result := result || jsonb_build_object(
      'posts', (select count(*) from public.posts where user_id = target.id and status = 'published' and visibility = 'public'),
      'problems_solved', (
        select count(distinct sp.slug)
        from public.session_problems sp
        join public.sessions s on s.id = sp.session_id
        join public.submissions su on su.session_problem_id = sp.id and su.accepted
        where s.user_id = target.id
      ),
      'total_active_ms', (select coalesce(sum(active_ms), 0) from public.sessions where user_id = target.id and status = 'ended')
    );
  end if;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- Storage buckets and policies
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('session-data', 'session-data', false, 52428800, array['application/gzip', 'application/json', 'application/octet-stream']),
  ('thumbnails', 'thumbnails', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Owner-scoped: first path segment must equal auth.uid()
create policy session_data_owner_all on storage.objects for all
  using (bucket_id = 'session-data' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'session-data' and (storage.foldername(name))[1] = auth.uid()::text);

create policy thumbnails_owner_all on storage.objects for all
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);

-- Thumbnails are readable by anyone who can view the video: path {owner}/{video_id}.jpg
create policy thumbnails_viewer_select on storage.objects for select
  using (
    bucket_id = 'thumbnails'
    and storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]+$'
    and public.can_view_video(substring(storage.filename(name) from 1 for 36)::uuid)
  );

create policy avatars_public_select on storage.objects for select using (bucket_id = 'avatars');
create policy avatars_owner_write on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_update on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_delete on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.posts, public.videos, public.sessions;
