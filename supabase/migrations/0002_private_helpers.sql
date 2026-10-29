-- Move RLS helper functions out of the API-exposed `public` schema into `private`
-- (fixes advisor lints 0011/0028/0029). Policies are recreated against private.*.

create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Drop policies that reference the helpers
-- ---------------------------------------------------------------------------
drop policy if exists sessions_select on public.sessions;
drop policy if exists session_events_select on public.session_events;
drop policy if exists session_events_insert on public.session_events;
drop policy if exists session_events_delete on public.session_events;
drop policy if exists session_problems_select on public.session_problems;
drop policy if exists session_problems_insert on public.session_problems;
drop policy if exists session_problems_update on public.session_problems;
drop policy if exists session_problems_delete on public.session_problems;
drop policy if exists submissions_select on public.submissions;
drop policy if exists submissions_insert on public.submissions;
drop policy if exists submissions_update on public.submissions;
drop policy if exists submissions_delete on public.submissions;
drop policy if exists videos_select on public.videos;
drop policy if exists posts_select on public.posts;
drop policy if exists transcripts_select on public.transcripts;
drop policy if exists transcripts_insert on public.transcripts;
drop policy if exists transcripts_update on public.transcripts;
drop policy if exists transcripts_delete on public.transcripts;
drop policy if exists interview_reviews_select on public.interview_reviews;
drop policy if exists interview_reviews_delete on public.interview_reviews;
drop policy if exists thumbnails_viewer_select on storage.objects;

-- ---------------------------------------------------------------------------
-- Drop public helpers (triggers are re-pointed below)
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists profiles_updated_at on public.profiles;
drop trigger if exists sessions_updated_at on public.sessions;
drop trigger if exists videos_updated_at on public.videos;
drop trigger if exists posts_updated_at on public.posts;

drop function if exists public.can_view_video(uuid);
drop function if exists public.can_view_session_problem(uuid);
drop function if exists public.owns_session_problem(uuid);
drop function if exists public.owns_session(uuid);
drop function if exists public.can_view_session_insights(uuid);
drop function if exists public.can_view_session(uuid);
drop function if exists public.can_view_post(public.posts);
drop function if exists public.can_view_profile_content(uuid);
drop function if exists public.is_accepted_follower(uuid);
drop function if exists public.handle_new_user();
drop function if exists public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Recreate helpers in private
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function private.handle_new_user()
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

create or replace function private.is_accepted_follower(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.follows f
    where f.followee_id = target and f.follower_id = auth.uid() and f.status = 'accepted'
  );
$$;

create or replace function private.can_view_profile_content(owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select owner = auth.uid()
    or not exists (select 1 from public.profiles p where p.id = owner and p.is_private)
    or private.is_accepted_follower(owner);
$$;

create or replace function private.can_view_post(p public.posts)
returns boolean language sql stable security definer set search_path = public as $$
  select p.user_id = auth.uid()
    or (p.status = 'published' and p.visibility = 'public' and private.can_view_profile_content(p.user_id));
$$;

create or replace function private.can_view_session(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions s where s.id = sid and s.user_id = auth.uid())
    or exists (select 1 from public.posts p where p.session_id = sid and private.can_view_post(p));
$$;

create or replace function private.can_view_session_insights(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions s where s.id = sid and s.user_id = auth.uid())
    or exists (
      select 1 from public.posts p
      where p.session_id = sid and p.include_ai_insights and private.can_view_post(p)
    );
$$;

create or replace function private.owns_session(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions s where s.id = sid and s.user_id = auth.uid());
$$;

create or replace function private.owns_session_problem(spid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.session_problems sp
    join public.sessions s on s.id = sp.session_id
    where sp.id = spid and s.user_id = auth.uid()
  );
$$;

create or replace function private.can_view_session_problem(spid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.session_problems sp
    where sp.id = spid and private.can_view_session(sp.session_id)
  );
$$;

create or replace function private.can_view_video(vid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.videos v where v.id = vid and v.user_id = auth.uid())
    or exists (select 1 from public.posts p where p.video_id = vid and private.can_view_post(p));
$$;

grant execute on all functions in schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger sessions_updated_at before update on public.sessions
  for each row execute function private.set_updated_at();
create trigger videos_updated_at before update on public.videos
  for each row execute function private.set_updated_at();
create trigger posts_updated_at before update on public.posts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Recreate policies
-- ---------------------------------------------------------------------------
create policy sessions_select on public.sessions for select
  using (user_id = auth.uid() or private.can_view_session(id));

create policy session_events_select on public.session_events for select using (private.owns_session(session_id));
create policy session_events_insert on public.session_events for insert with check (private.owns_session(session_id));
create policy session_events_delete on public.session_events for delete using (private.owns_session(session_id));

create policy session_problems_select on public.session_problems for select using (private.can_view_session(session_id));
create policy session_problems_insert on public.session_problems for insert with check (private.owns_session(session_id));
create policy session_problems_update on public.session_problems for update using (private.owns_session(session_id)) with check (private.owns_session(session_id));
create policy session_problems_delete on public.session_problems for delete using (private.owns_session(session_id));

create policy submissions_select on public.submissions for select using (private.can_view_session_problem(session_problem_id));
create policy submissions_insert on public.submissions for insert with check (private.owns_session_problem(session_problem_id));
create policy submissions_update on public.submissions for update using (private.owns_session_problem(session_problem_id)) with check (private.owns_session_problem(session_problem_id));
create policy submissions_delete on public.submissions for delete using (private.owns_session_problem(session_problem_id));

create policy videos_select on public.videos for select using (user_id = auth.uid() or private.can_view_video(id));

create policy posts_select on public.posts for select using (private.can_view_post(posts));

create policy transcripts_select on public.transcripts for select using (private.can_view_session_insights(session_id));
create policy transcripts_insert on public.transcripts for insert with check (private.owns_session(session_id));
create policy transcripts_update on public.transcripts for update using (private.owns_session(session_id)) with check (private.owns_session(session_id));
create policy transcripts_delete on public.transcripts for delete using (private.owns_session(session_id));

create policy interview_reviews_select on public.interview_reviews for select using (private.can_view_session_insights(session_id));
create policy interview_reviews_delete on public.interview_reviews for delete using (private.owns_session(session_id));

create policy thumbnails_viewer_select on storage.objects for select
  using (
    bucket_id = 'thumbnails'
    and storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]+$'
    and private.can_view_video(substring(storage.filename(name) from 1 for 36)::uuid)
  );

-- ---------------------------------------------------------------------------
-- Public RPCs: re-point profile_stats, tighten grants
-- ---------------------------------------------------------------------------
create or replace function public.profile_stats(target_handle extensions.citext)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
  visible boolean;
  result jsonb;
begin
  select * into target from public.profiles where handle = target_handle;
  if target.id is null then return null; end if;
  visible := private.can_view_profile_content(target.id);
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

revoke execute on function public.request_follow(extensions.citext) from anon, public;
revoke execute on function public.accept_follow(uuid) from anon, public;
revoke execute on function public.decline_follow(uuid) from anon, public;
