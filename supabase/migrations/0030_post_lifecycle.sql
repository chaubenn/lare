-- Lare 0030: practice posts can be taken back, sessions can get their draft back, and a double
-- publish no longer leaves an empty post.
--
--   * publish_practice_problems (0013) — two concurrent calls with the same selection (a double
--     click, a retry racing the first request) both counted the problems as still in the inbox,
--     because both read before either moved anything. The second then waited on the first's row
--     locks, re-checked `session_id = inbox_id`, moved nothing, and still created its session and
--     draft: an empty post. The problems are now locked while they are counted, so the second call
--     sees them gone and fails with the usual "not in your inbox" error, and the move itself must
--     account for every problem or the whole call rolls back.
--   * delete_practice_post(p_post_id) — the inverse of publish_practice_problems: the post's
--     problems (with their submissions) go back to the inbox, then the post and the session it
--     minted are deleted.
--   * create_session_draft(p_session_id) — a finished session whose draft or post was deleted gets
--     a fresh draft, built the way the extension builds one when an interview ends.
--
-- Idempotent: safe to run twice.

-- ---------------------------------------------------------------------------
-- publish_practice_problems(problem_ids, title) -> draft post id
-- ---------------------------------------------------------------------------
create or replace function public.publish_practice_problems(
  problem_ids uuid[],
  post_title text default null
)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inbox_id uuid;
  wanted integer := coalesce(array_length(problem_ids, 1), 0);
  owned integer;
  moved integer;
  new_session_id uuid;
  new_post_id uuid;
  first_title text;
  span_start timestamptz;
  span_end timestamptz;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if wanted = 0 then
    raise exception 'select at least one problem';
  end if;

  select id into inbox_id
  from public.sessions
  where user_id = uid and is_practice_inbox;
  if inbox_id is null then
    raise exception 'no tracked problems yet';
  end if;

  -- Every id must be an un-posted problem sitting in *this* caller's inbox. Locking them here
  -- makes a concurrent publish of the same problems wait, then re-check, and find them gone.
  select count(*) into owned
  from (
    select sp.id
    from public.session_problems sp
    where sp.id = any(problem_ids) and sp.session_id = inbox_id
    for update
  ) locked;
  if owned <> wanted then
    raise exception 'some problems are not in your inbox (% of % matched)', owned, wanted;
  end if;

  select min(sp.opened_at),
         greatest(max(sp.opened_at), coalesce(max(sub.last_submitted), max(sp.opened_at))),
         min(sp.title)
    into span_start, span_end, first_title
  from public.session_problems sp
  left join (
    select session_problem_id, max(submitted_at) as last_submitted
    from public.submissions
    group by session_problem_id
  ) sub on sub.session_problem_id = sp.id
  where sp.id = any(problem_ids);

  -- active_ms stays 0: passive tracking has no timer, so there is no honest
  -- duration to report. Renderers treat 0 as "no duration" and hide it.
  insert into public.sessions (
    user_id, kind, scope, status, started_at, ended_at, active_ms, client
  )
  values (
    uid,
    'practice',
    (case when wanted = 1 then 'problem' else 'session' end)::public.session_scope,
    'ended',
    coalesce(span_start, now()),
    coalesce(span_end, now()),
    0,
    'inbox'
  )
  returning id into new_session_id;

  update public.session_problems
  set session_id = new_session_id
  where id = any(problem_ids) and session_id = inbox_id;
  get diagnostics moved = row_count;
  if moved <> wanted then
    raise exception 'some problems were published elsewhere meanwhile (% of % moved)', moved, wanted;
  end if;

  insert into public.posts (
    user_id, session_id, status, visibility, title, video_kind, include_ai_insights
  )
  values (
    uid,
    new_session_id,
    'draft',
    'public',
    coalesce(
      nullif(btrim(post_title), ''),
      case when wanted = 1 then first_title else wanted || ' problems' end
    ),
    'none',
    false
  )
  returning id into new_post_id;

  return new_post_id;
end $$;

revoke execute on function public.publish_practice_problems(uuid[], text) from anon, public;
grant execute on function public.publish_practice_problems(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_practice_post(p_post_id) -> problems back to the inbox, post and session gone
-- ---------------------------------------------------------------------------
-- Only for posts publish_practice_problems made: their session is `client = 'inbox'`, and moving
-- its problems back is exactly undoing that call. Draft or published both work. Interview posts
-- (and old explicit practice sessions) have no inbox to go back to and are refused; deleting
-- those stays a plain post delete.
--
-- The inbox comes from practice_inbox(), so it is created if the user has since lost it. Deleting
-- the post cascades its likes, comments, media rows and notifications, as a normal delete does;
-- photo files in the `post-media` bucket and any attached videos are left for the client to clean
-- up, also as a normal delete does. One transaction: a failure anywhere leaves everything as it was.
create or replace function public.delete_practice_post(p_post_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target_session uuid;
  session_client text;
  session_is_inbox boolean;
  inbox_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select p.session_id into target_session
  from public.posts p
  where p.id = p_post_id and p.user_id = uid
  for update;
  if not found then
    raise exception 'Post not found' using errcode = 'P0002';
  end if;
  if target_session is null then
    raise exception 'This post has no practice session to return to the inbox' using errcode = '22023';
  end if;

  select s.client, s.is_practice_inbox into session_client, session_is_inbox
  from public.sessions s
  where s.id = target_session and s.user_id = uid
  for update;
  if not found or session_is_inbox or session_client is distinct from 'inbox' then
    raise exception 'Only practice posts made from tracked problems can be returned to the inbox'
      using errcode = '22023';
  end if;

  inbox_id := public.practice_inbox();

  update public.session_problems
  set session_id = inbox_id
  where session_id = target_session;

  delete from public.posts where id = p_post_id;
  delete from public.sessions where id = target_session and user_id = uid;
end $$;

revoke execute on function public.delete_practice_post(uuid) from public, anon;
grant execute on function public.delete_practice_post(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_session_draft(p_session_id) -> draft post id
-- ---------------------------------------------------------------------------
-- For the caller's own ended session that has lost its post. If the session already has one
-- (draft or published), that id is returned and nothing changes.
--
-- Mirrors what the extension's finalizeSession inserts when an interview ends: status draft,
-- visibility public, AI insights off, and the title it would pick (the problem's title for a
-- single problem, "N problems" for several, otherwise "Mock interview" / "Practice session").
-- The desktop then attaches the session's recording as the main video (`video_kind = 'full'`); a
-- re-created draft gets the same link straight away when the session has a video that is not
-- failed and not already on another post (videos carry `session_id` from bunny-create-upload).
create or replace function public.create_session_draft(p_session_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s public.sessions%rowtype;
  existing uuid;
  problem_count integer;
  first_title text;
  draft_title text;
  vid uuid;
  new_post_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- The lock serialises concurrent calls for the same session, so only one draft is made.
  select * into s
  from public.sessions
  where id = p_session_id and user_id = uid
  for update;
  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;

  select p.id into existing from public.posts p where p.session_id = s.id;
  if existing is not null then
    return existing;
  end if;

  if s.is_practice_inbox then
    raise exception 'The practice inbox has no post; publish tracked problems instead'
      using errcode = '22023';
  end if;
  if s.status <> 'ended' then
    raise exception 'Only a finished session can get a draft' using errcode = '22023';
  end if;

  select count(*) into problem_count from public.session_problems where session_id = s.id;
  select sp.title into first_title
  from public.session_problems sp
  where sp.session_id = s.id
  order by sp.opened_at, sp.created_at
  limit 1;

  draft_title := case
    when problem_count = 1 then first_title
    when problem_count > 1 then problem_count || ' problems'
    when s.kind = 'interview' then 'Mock interview'
    else 'Practice session'
  end;

  select v.id into vid
  from public.videos v
  where v.session_id = s.id
    and v.user_id = uid
    and v.status <> 'failed'
    and not exists (
      select 1 from public.posts p where p.video_id = v.id or p.demo_video_id = v.id
    )
  order by v.created_at desc
  limit 1;

  insert into public.posts (
    user_id, session_id, status, visibility, title, include_ai_insights, video_id, video_kind
  )
  values (
    uid,
    s.id,
    'draft',
    'public',
    left(draft_title, 140),
    false,
    vid,
    (case when vid is null then 'none' else 'full' end)::public.video_kind
  )
  on conflict (session_id) do nothing
  returning id into new_post_id;

  if new_post_id is null then
    select p.id into new_post_id from public.posts p where p.session_id = s.id;
  end if;
  return new_post_id;
end $$;

revoke execute on function public.create_session_draft(uuid) from public, anon;
grant execute on function public.create_session_draft(uuid) to authenticated;
