-- Lare 0034: one usage ledger for everything that costs money or pages other people.
--
-- 0025 gave AI reviews an append-only ledger and a claim function. Two other actions needed the
-- same and had nothing:
--   * `bunny-create-upload` creates a Bunny video and hands out 24-hour TUS credentials on every
--     call, so a script with one free account could run up the storage and encoding bill.
--   * A comment can notify up to ten mentioned users (0021) and nothing limited comments, so a loop
--     of comments on any public post could page chosen people without end.
--
-- `usage_ledger` holds every claim, keyed by `kind`, and `claim_usage(user, kind, limit, ref)` is
-- the only writer: under a per-user, per-kind advisory lock it counts the last 24 hours and either
-- records the claim or answers false. Callers decide the limit:
--   * ai_review      5 a day     (ai-review; `claim_ai_review_slot` now delegates here)
--   * video_upload   50 a day    (bunny-create-upload; several takes per post and retries of
--                                 expired upload targets each create one)
--   * comment        100 a day   (trigger below; the comment is refused past it)
--   * comment_mention 50 a day   (mention notifications; past it the comment still posts but
--                                 stops paging people)
-- Users can read their own rows; nobody but the service role and the database's own triggers can
-- write them. The AI review history in `ai_review_usage` is copied in so the deploy does not hand
-- everybody a fresh allowance; that table is no longer written.
--
-- Idempotent: safe to run twice.

-- ---------------------------------------------------------------------------
-- usage_ledger
-- ---------------------------------------------------------------------------
create table if not exists public.usage_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z_]{0,39}$'),
  -- What the claim was for (session, post, comment); kept for support and auditing only.
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists usage_ledger_user_kind_created_idx
  on public.usage_ledger (user_id, kind, created_at desc);

alter table public.usage_ledger enable row level security;
drop policy if exists usage_ledger_select on public.usage_ledger;
create policy usage_ledger_select on public.usage_ledger for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.usage_ledger from anon, authenticated;
grant select on public.usage_ledger to authenticated;

insert into public.usage_ledger (user_id, kind, ref_id, created_at)
select u.user_id, 'ai_review', u.session_id, u.created_at
from public.ai_review_usage u
where not exists (
  select 1 from public.usage_ledger l
  where l.kind = 'ai_review'
    and l.user_id = u.user_id
    and l.created_at = u.created_at
    and l.ref_id is not distinct from u.session_id
);

comment on table public.ai_review_usage is
  'Superseded by usage_ledger (kind ai_review) in 0034. Kept for history; no longer written.';

-- ---------------------------------------------------------------------------
-- claim_usage(user, kind, limit, ref) -> true when a claim was recorded, false at the limit
-- ---------------------------------------------------------------------------
-- Service role only: callers have already authenticated the user, and a client must never be able
-- to write usage rows (or skip writing them).
create or replace function public.claim_usage(
  p_user_id uuid,
  p_kind text,
  p_limit integer,
  p_ref_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  if p_user_id is null or p_kind is null or p_limit is null or p_limit < 1 then
    raise exception 'Invalid usage claim' using errcode = '22023';
  end if;

  -- Serialise this user's concurrent claims of one kind; released at commit.
  perform pg_advisory_xact_lock(hashtextextended('usage:' || p_kind || ':' || p_user_id::text, 0));

  select count(*) into used
  from public.usage_ledger
  where user_id = p_user_id
    and kind = p_kind
    and created_at > now() - interval '24 hours';
  if used >= p_limit then
    return false;
  end if;

  insert into public.usage_ledger (user_id, kind, ref_id) values (p_user_id, p_kind, p_ref_id);
  return true;
end $$;

revoke all on function public.claim_usage(uuid, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_usage(uuid, text, integer, uuid) to service_role;

-- 0025's entry point, kept for an ai-review deployed before this migration.
create or replace function public.claim_ai_review_slot(
  p_user_id uuid,
  p_session_id uuid,
  p_daily_limit integer
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select public.claim_usage(p_user_id, 'ai_review', p_daily_limit, p_session_id);
$$;

revoke all on function public.claim_ai_review_slot(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_review_slot(uuid, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Comments: 100 a day per author
-- ---------------------------------------------------------------------------
create or replace function private.limit_comments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.claim_usage(new.user_id, 'comment', 100, new.post_id) then
    raise exception 'Comment limit reached (100 per day). Try again later.';
  end if;
  return new;
end $$;

revoke all on function private.limit_comments() from public, anon, authenticated;

drop trigger if exists post_comments_limit on public.post_comments;
create trigger post_comments_limit before insert on public.post_comments
  for each row execute function private.limit_comments();

-- ---------------------------------------------------------------------------
-- Mention notifications: 50 a day per author (0021, otherwise unchanged)
-- ---------------------------------------------------------------------------
create or replace function private.notify_post_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_owner uuid;
  mentioned uuid;
begin
  for mentioned in
    select m.id
    from private.comment_mentions(new.body) as m(id)
    where m.id <> new.user_id
      and private.user_can_view_post(new.post_id, m.id)
      and not exists (
        select 1 from public.notifications n where n.comment_id = new.id and n.recipient_id = m.id
      )
  loop
    exit when not public.claim_usage(new.user_id, 'comment_mention', 50, new.id);
    insert into public.notifications (recipient_id, actor_id, type, post_id, comment_id)
    values (mentioned, new.user_id, 'comment_mention', new.post_id, new.id);
  end loop;

  -- Edits only ever add mentions; replies and the owner's notice belong to the first insert.
  if tg_op = 'UPDATE' then
    return new;
  end if;

  if new.parent_id is not null then
    insert into public.notifications (recipient_id, actor_id, type, post_id, comment_id)
    select t.user_id, new.user_id, 'comment_reply'::public.notification_type, new.post_id, new.id
    from (
      select c.user_id from public.post_comments c where c.id = new.parent_id
      union
      select c.user_id from public.post_comments c where c.parent_id = new.parent_id
    ) t
    where t.user_id <> new.user_id
      and private.user_can_view_post(new.post_id, t.user_id)
      and not exists (
        select 1 from public.notifications n where n.comment_id = new.id and n.recipient_id = t.user_id
      );
  end if;

  select p.user_id into post_owner from public.posts p where p.id = new.post_id;
  if post_owner is not null and post_owner <> new.user_id and not exists (
    select 1 from public.notifications n where n.comment_id = new.id and n.recipient_id = post_owner
  ) then
    insert into public.notifications (recipient_id, actor_id, type, post_id, comment_id)
    values (post_owner, new.user_id, 'post_comment', new.post_id, new.id);
  end if;
  return new;
end $$;

revoke all on function private.notify_post_comment() from public, anon, authenticated;
