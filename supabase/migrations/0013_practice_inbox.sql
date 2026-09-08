-- ---------------------------------------------------------------------------
-- Passive practice tracking ("the inbox")
--
-- Practice used to be an explicit session: you pressed start in the on-page
-- overlay, solved, pressed end, and that produced one draft post per session.
-- The overlay is gone; the extension now just watches every problem you open
-- and every submission you make, with no timer and nothing to start.
--
-- Those observations land in a single long-lived session per user — the inbox.
-- It is a real `sessions` row (so `session_problems` / `submissions` and all
-- their RLS keep working untouched) flagged with `is_practice_inbox`, held
-- `active` forever, and it never has a post.
--
-- Publishing is `publish_practice_problems`: it mints a fresh session for the
-- post and *moves* the selected problems onto it. Moving rather than copying
-- means no duplicated `session_problems` / `submissions` / `edits_path` rows,
-- and a problem leaving the inbox is exactly what "it has been posted" means,
-- so no extra bookkeeping column is needed to hide it from the picker.
--
-- Mock interviews are unchanged: they still open their own session, still time
-- themselves, and still finalise into their own post.
-- ---------------------------------------------------------------------------

alter table public.sessions
  add column if not exists is_practice_inbox boolean not null default false;

-- One inbox per user. Partial, so ordinary sessions are unconstrained.
create unique index if not exists sessions_practice_inbox_key
  on public.sessions (user_id)
  where is_practice_inbox;

comment on column public.sessions.is_practice_inbox is
  'Long-lived staging session holding passively-tracked practice problems. Never has a post.';

-- ---------------------------------------------------------------------------
-- practice_inbox() -> the caller's inbox session id, creating it on first use
-- ---------------------------------------------------------------------------
-- Definer because it upserts a `sessions` row; the owner is pinned to auth.uid()
-- so it can only ever create the caller's own inbox.
--
-- Call this as its own statement and reuse the id. Inlining it —
-- `insert into session_problems (session_id, ...) values (practice_inbox(), ...)`
-- — fails the `owns_session` RLS check on a first-ever call: that helper is
-- STABLE, so it reads the statement snapshot and cannot see the session this
-- function just inserted within that same statement.
create or replace function public.practice_inbox()
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inbox_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select id into inbox_id
  from public.sessions
  where user_id = uid and is_practice_inbox;

  if inbox_id is not null then
    return inbox_id;
  end if;

  insert into public.sessions (user_id, kind, scope, status, is_practice_inbox, active_ms)
  values (uid, 'practice', 'session', 'active', true, 0)
  on conflict (user_id) where is_practice_inbox do update set updated_at = now()
  returning id into inbox_id;

  return inbox_id;
end $$;

revoke execute on function public.practice_inbox() from anon, public;
grant execute on function public.practice_inbox() to authenticated;

-- ---------------------------------------------------------------------------
-- publish_practice_problems(problem_ids, title) -> draft post id
-- ---------------------------------------------------------------------------
-- Mints the session the post will own and moves the chosen problems onto it, so
-- the post -> session -> problems -> submissions shape every renderer already
-- expects is preserved. Definer so the whole move is one transaction; the
-- ownership check below is the gate.
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

  -- Every id must be an un-posted problem sitting in *this* caller's inbox.
  select count(*) into owned
  from public.session_problems
  where id = any(problem_ids) and session_id = inbox_id;
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
-- Migrate existing data into the new shape
-- ---------------------------------------------------------------------------
-- Practice sessions left `active`/`paused` with no post are leftovers of the
-- old start/stop flow — nobody ever pressed end, so they would otherwise sit
-- there forever and never be publishable. Give each affected user an inbox,
-- move the orphaned problems into it (so no captured work is lost), and retire
-- the empty shells as `abandoned`.
--
-- Interviews are untouched: their lifecycle has not changed.
do $$
declare
  u record;
  inbox_id uuid;
begin
  for u in
    select distinct s.user_id
    from public.sessions s
    left join public.posts p on p.session_id = s.id
    where s.kind = 'practice'
      and s.status in ('active', 'paused')
      and not s.is_practice_inbox
      and p.id is null
  loop
    select id into inbox_id
    from public.sessions
    where user_id = u.user_id and is_practice_inbox;

    if inbox_id is null then
      insert into public.sessions (user_id, kind, scope, status, is_practice_inbox, active_ms)
      values (u.user_id, 'practice', 'session', 'active', true, 0)
      returning id into inbox_id;
    end if;

    update public.session_problems sp
    set session_id = inbox_id
    where sp.session_id in (
      select s.id
      from public.sessions s
      left join public.posts p on p.session_id = s.id
      where s.user_id = u.user_id
        and s.kind = 'practice'
        and s.status in ('active', 'paused')
        and not s.is_practice_inbox
        and p.id is null
    );

    update public.sessions s
    set status = 'abandoned', ended_at = coalesce(s.ended_at, now())
    where s.user_id = u.user_id
      and s.kind = 'practice'
      and s.status in ('active', 'paused')
      and not s.is_practice_inbox
      and not exists (select 1 from public.posts p where p.session_id = s.id);
  end loop;
end $$;
