-- Isolated PostgreSQL fixture, NOT a migration. Run only against an empty disposable database.
create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.sessions (id uuid primary key, user_id uuid not null);
create table public.videos (id uuid primary key, user_id uuid not null, session_id uuid references public.sessions(id), bunny_video_id uuid, library_id bigint);
create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions(id),
  model text not null, language text not null default 'en', segments jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create table public.interview_reviews (session_id uuid primary key references public.sessions(id));
\i /migration.sql
\i /migration.sql

insert into sessions values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', true);
insert into sessions values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000022', false);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
select public.upsert_transcript_segments('00000000-0000-0000-0000-000000000001', 'whisper', 'en', '[{"s":0,"e":1000,"text":"first"}]');
select public.upsert_transcript_segments('00000000-0000-0000-0000-000000000001', 'whisper', 'en', '[{"s":0,"e":1000,"text":"corrected"},{"s":1000,"e":2000,"text":"second"}]');
select public.upsert_transcript_segments('00000000-0000-0000-0000-000000000001', 'whisper', 'en', '[{"s":1000,"e":2000,"text":"second"}]');

do $$ begin
  if (select segments from transcripts limit 1) <> '[{"s":0,"e":1000,"text":"corrected"},{"s":1000,"e":2000,"text":"second"}]'::jsonb then
    raise exception 'Atomic merge/retry failed';
  end if;
  if has_function_privilege('anon', 'public.upsert_transcript_segments(uuid,text,text,jsonb)', 'execute') then
    raise exception 'Anon must not invoke transcript writes';
  end if;
  if not has_function_privilege('authenticated', 'public.upsert_transcript_segments(uuid,text,text,jsonb)', 'execute') then
    raise exception 'Authenticated must be able to invoke transcript writes';
  end if;
  begin
    perform public.upsert_transcript_segments('00000000-0000-0000-0000-000000000002', 'whisper', 'en', '[]');
    raise exception 'Cross-owner transcript write succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.upsert_transcript_segments('00000000-0000-0000-0000-000000000001', 'whisper', 'en', '[{"s":-1,"e":0,"text":"bad"}]');
    raise exception 'Negative timestamp accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.upsert_transcript_segments('00000000-0000-0000-0000-000000000001', 'whisper', 'en', '[{"s":0}]');
    raise exception 'Missing segment fields accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into videos(id,user_id,session_id) values ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002');
    raise exception 'Cross-owner video attachment succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into interview_reviews values ('00000000-0000-0000-0000-000000000002');
    raise exception 'Late review of ungraded session succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
insert into videos(id,user_id,session_id) values ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001');
do $$ begin
  if (select capture_source from videos limit 1) <> 'desktop' then raise exception 'Wrong capture source default'; end if;
  begin
    update videos set bunny_video_id = '00000000-0000-0000-0000-000000000099';
    raise exception 'Bunny identity replacement succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
