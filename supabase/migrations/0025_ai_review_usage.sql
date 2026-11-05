-- Lare 0025: the AI review limit counts requests, and a review only reads the caller's own files.
--
-- 1. Usage ledger.
--    `ai-review` used to enforce "5 per rolling 24h" by counting `interview_reviews` rows. Those
--    rows are a cache, not a ledger: regenerating upserts over the same `session_id` row (so the
--    count never grows) and owners may delete their own reviews (so it shrinks). Either way the
--    limit, and the OpenAI bill behind it, was unbounded.
--
--    `ai_review_usage` is append-only from the user's point of view: they can read their own
--    rows (so the app can show what is left) and nothing else. Rows are written only by
--    `claim_ai_review_slot`, which the Edge Function calls with the service role before it calls
--    OpenAI. The check and the insert happen under a per-user advisory lock in one transaction, so
--    parallel requests cannot all see "4 used" and each take the fifth slot.
--
-- 2. `session_problems.edits_path`.
--    The path of a problem's Monaco edit log in the private `session-data` bucket is written by
--    the extension as `{user_id}/{session_id}/{session_problem_id}.json.gz`, and the bucket's own
--    policy only lets a user write under their `{user_id}/` folder. But the column itself was free
--    text, and `ai-review` downloads it with the service role, which ignores storage policies: a
--    user could point their own row at somebody else's edit log and have it summarised back to
--    them. The function now refuses paths outside the caller's folder, and this trigger stops such
--    paths being stored at all. Only the first segment is pinned: publishing tracked practice
--    problems moves rows between sessions without renaming their files, so the session segment
--    legitimately stops matching.
--
-- Idempotent: safe to run twice.

-- ---------------------------------------------------------------------------
-- ai_review_usage
-- ---------------------------------------------------------------------------
create table if not exists public.ai_review_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Kept for support and auditing only; the limit is per user, not per session.
  session_id uuid references public.sessions (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ai_review_usage_user_created_idx
  on public.ai_review_usage (user_id, created_at desc);

alter table public.ai_review_usage enable row level security;
drop policy if exists ai_review_usage_select on public.ai_review_usage;
create policy ai_review_usage_select on public.ai_review_usage for select to authenticated
  using (user_id = (select auth.uid()));

-- No insert/update/delete policies, and no table privileges to back them either.
revoke all on public.ai_review_usage from anon, authenticated;
grant select on public.ai_review_usage to authenticated;

-- Seed the ledger with the reviews generated in the last day, so the deploy does not hand
-- everybody a fresh allowance. Matched on (session, created_at) so a re-run inserts nothing.
insert into public.ai_review_usage (user_id, session_id, created_at)
select s.user_id, r.session_id, r.created_at
from public.interview_reviews r
join public.sessions s on s.id = r.session_id
where r.created_at > now() - interval '24 hours'
  and not exists (
    select 1 from public.ai_review_usage u
    where u.session_id = r.session_id and u.created_at = r.created_at
  );

-- claim_ai_review_slot(user, session, limit) -> true when a slot was taken, false at the limit.
-- Service role only: the Edge Function has already authenticated the user and checked that the
-- session is theirs, and a client must never be able to write usage rows (or skip writing them).
create or replace function public.claim_ai_review_slot(
  p_user_id uuid,
  p_session_id uuid,
  p_daily_limit integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  used integer;
begin
  if p_user_id is null or p_daily_limit is null or p_daily_limit < 1 then
    raise exception 'Invalid AI review claim' using errcode = '22023';
  end if;

  -- Serialise this user's concurrent claims; released at commit.
  perform pg_advisory_xact_lock(hashtextextended('ai_review_usage:' || p_user_id::text, 0));

  select count(*) into used
  from public.ai_review_usage
  where user_id = p_user_id
    and created_at > now() - interval '24 hours';
  if used >= p_daily_limit then
    return false;
  end if;

  insert into public.ai_review_usage (user_id, session_id) values (p_user_id, p_session_id);
  return true;
end $$;

revoke all on function public.claim_ai_review_slot(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_review_slot(uuid, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- session_problems.edits_path stays inside its owner's storage folder
-- ---------------------------------------------------------------------------
-- Every role, the service role included: nothing legitimate ever writes a path elsewhere.
-- Rejects empty, `.` and `..` segments and backslashes so the prefix cannot be walked out of.
create or replace function private.check_edits_path_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
begin
  if new.edits_path is null then
    return new;
  end if;
  select s.user_id into owner from public.sessions s where s.id = new.session_id;
  if owner is null
     or split_part(new.edits_path, '/', 1) <> owner::text
     or new.edits_path !~ '^[^/\\]+(/[^/\\]+)+$'
     or new.edits_path ~ '(^|/)\.\.?(/|$)'
  then
    raise exception 'Edit log path must be inside your own folder' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function private.check_edits_path_owner() from public, anon, authenticated;

drop trigger if exists session_problems_edits_path_owner on public.session_problems;
create trigger session_problems_edits_path_owner
  before insert or update of edits_path, session_id on public.session_problems
  for each row execute function private.check_edits_path_owner();
