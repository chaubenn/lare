-- V1: safe to reapply. Existing recordings were captured on desktop.
do $$ begin
  create type public.capture_source as enum ('desktop', 'extension', 'web');
exception when duplicate_object then null;
end $$;

alter table public.sessions add column if not exists graded boolean not null default true;
alter table public.videos add column if not exists capture_source public.capture_source not null default 'desktop';

-- Only the authenticated Edge Function may assign a Bunny identity. Letting clients
-- fabricate rows/replace GUIDs would turn playback-token issuance into an ownership bypass.
drop policy if exists videos_insert on public.videos;
revoke insert on public.videos from anon, authenticated;
create or replace function public.protect_video_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id or
     new.bunny_video_id is distinct from old.bunny_video_id or new.library_id is distinct from old.library_id then
    raise exception 'Video identity is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.protect_video_identity() from public, anon, authenticated;
drop trigger if exists videos_identity_immutable on public.videos;
create trigger videos_identity_immutable before update on public.videos
for each row execute function public.protect_video_identity();

-- Serialize on the session even before its first transcript row exists. Retried windows
-- replace equal start timestamps; producer owns overlap/word deduplication.
create or replace function public.upsert_transcript_segments(
  p_session_id uuid, p_model text, p_language text, p_segments jsonb
) returns public.transcripts
language plpgsql security definer set search_path = '' as $$
declare
  result public.transcripts;
  segment jsonb;
begin
  perform 1 from public.sessions where id = p_session_id and user_id = auth.uid() for update;
  if not found then raise exception 'Session not found' using errcode = '42501'; end if;
  if p_model is null or length(p_model) not between 1 and 200 or
     p_language is null or length(p_language) not between 1 and 32 or
     p_segments is null or jsonb_typeof(p_segments) <> 'array' then
    raise exception 'Invalid transcript input' using errcode = '22023';
  end if;
  if jsonb_array_length(p_segments) > 10000 then
    raise exception 'Too many segments in one window' using errcode = '22023';
  end if;
  for segment in select value from jsonb_array_elements(p_segments) loop
    if jsonb_typeof(segment) <> 'object' or
       jsonb_typeof(segment->'s') is distinct from 'number' or
       jsonb_typeof(segment->'e') is distinct from 'number' or
       jsonb_typeof(segment->'text') is distinct from 'string' then
      raise exception 'Invalid transcript segment' using errcode = '22023';
    end if;
    if (segment->>'s')::numeric < 0 or (segment->>'e')::numeric < (segment->>'s')::numeric then
      raise exception 'Invalid transcript timestamps' using errcode = '22023';
    end if;
  end loop;
  insert into public.transcripts(session_id, model, language, segments)
  values (p_session_id, p_model, p_language, '[]') on conflict (session_id) do nothing;
  update public.transcripts t set model = p_model, language = p_language,
    segments = (
      select coalesce(jsonb_agg(value order by (value->>'s')::numeric), '[]'::jsonb)
      from (
        select distinct on ((value->>'s')::numeric) value
        from jsonb_array_elements(t.segments || p_segments) with ordinality as items(value, position)
        order by (value->>'s')::numeric, position desc
      ) merged
    )
  where t.session_id = p_session_id returning * into result;
  return result;
end $$;
revoke all on function public.upsert_transcript_segments(uuid, text, text, jsonb) from public, anon;
grant execute on function public.upsert_transcript_segments(uuid, text, text, jsonb) to authenticated;

-- RLS user_id checks alone do not protect cross-owner foreign-key attachment.
create or replace function public.check_video_session_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.session_id is not null and not exists (
    select 1 from public.sessions s where s.id = new.session_id and s.user_id = new.user_id
  ) then raise exception 'Session not found' using errcode = '42501'; end if;
  return new;
end $$;
revoke all on function public.check_video_session_owner() from public, anon, authenticated;
drop trigger if exists videos_session_owner on public.videos;
create trigger videos_session_owner before insert or update of session_id, user_id on public.videos
for each row execute function public.check_video_session_owner();

-- A review request may finish after the extension downgraded a disconnected session.
-- Lock against concurrent graded updates and reject that late write, including service-role writes.
create or replace function public.require_graded_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.sessions where id = new.session_id and graded for share;
  if not found then raise exception 'AI review is disabled for this session' using errcode = '42501'; end if;
  return new;
end $$;
revoke all on function public.require_graded_review() from public, anon, authenticated;
drop trigger if exists interview_reviews_require_graded on public.interview_reviews;
create trigger interview_reviews_require_graded before insert or update on public.interview_reviews
for each row execute function public.require_graded_review();
