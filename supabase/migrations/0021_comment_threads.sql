-- Lare 0021: comment replies and @mentions.
--
--   * post_comments.parent_id — a reply points at the top-level comment it answers. Threads are one
--     level deep: replying to a reply attaches to the same top-level comment, which is what the app
--     sends and what the check below enforces.
--   * comment_reply notifications — a reply tells everyone already in that thread (the top-level
--     comment's author and every other replier).
--   * comment_mention notifications — `@handle` in a comment tells that person, on insert and when
--     an edit adds a name that was not there before.
--
-- Each recipient gets one notification per comment, picked in order: mention, then reply, then the
-- post owner's existing post_comment. Nobody is told about a post they cannot see, so a mention
-- cannot be used to probe or advertise a private post.
--
-- Idempotent: safe to run twice.

alter table public.post_comments
  add column if not exists parent_id uuid references public.post_comments (id) on delete cascade;
create index if not exists post_comments_parent_idx
  on public.post_comments (parent_id, created_at) where parent_id is not null;

create index if not exists notifications_comment_idx
  on public.notifications (comment_id, recipient_id) where comment_id is not null;

-- ALTER TYPE ... ADD VALUE is allowed in a transaction; the new values are only used at runtime
-- inside the function bodies below, never at creation time.
alter type public.notification_type add value if not exists 'comment_reply';
alter type public.notification_type add value if not exists 'comment_mention';

-- A reply must answer a top-level comment on the same post.
create or replace function private.check_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.post_comments c
    where c.id = new.parent_id and c.post_id = new.post_id and c.parent_id is null
  ) then
    raise exception 'Comment to reply to not found' using errcode = '23503';
  end if;
  return new;
end $$;

drop trigger if exists post_comments_parent on public.post_comments;
create trigger post_comments_parent before insert on public.post_comments
  for each row execute function private.check_comment_parent();

-- The parent joins the columns an edit may not change.
create or replace function private.freeze_comment_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  new.id := old.id;
  new.post_id := old.post_id;
  new.user_id := old.user_id;
  new.parent_id := old.parent_id;
  new.created_at := old.created_at;
  return new;
end $$;

-- `private.can_view_post` answers for auth.uid(); notifications need the answer for the recipient.
create or replace function private.user_can_view_post(pid uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.posts p
    where p.id = pid
      and (
        p.user_id = viewer
        or (
          p.status = 'published'
          and p.visibility = 'public'
          and private.post_videos_ready(p)
          and (
            not exists (select 1 from public.profiles o where o.id = p.user_id and o.is_private)
            or exists (
              select 1 from public.follows f
              where f.followee_id = p.user_id and f.follower_id = viewer and f.status = 'accepted'
            )
          )
        )
      )
  );
$$;

-- Profiles named with `@handle` in a comment body. Handles are 3-20 of [a-z0-9_]; an `@` glued to
-- a word (an email address) is not a mention. Capped so one comment cannot page half the site.
create or replace function private.comment_mentions(body text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from (
    select distinct m[2] as handle
    from regexp_matches(lower(body), '(^|[^a-z0-9_])@([a-z0-9_]{3,20})(?![a-z0-9_])', 'g') as m
    limit 10
  ) h
  join public.profiles p on p.handle = h.handle;
$$;

create or replace function private.notify_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_owner uuid;
begin
  insert into public.notifications (recipient_id, actor_id, type, post_id, comment_id)
  select m.id, new.user_id, 'comment_mention'::public.notification_type, new.post_id, new.id
  from private.comment_mentions(new.body) as m(id)
  where m.id <> new.user_id
    and private.user_can_view_post(new.post_id, m.id)
    and not exists (
      select 1 from public.notifications n where n.comment_id = new.id and n.recipient_id = m.id
    );

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

drop trigger if exists post_comments_notify on public.post_comments;
create trigger post_comments_notify after insert on public.post_comments
  for each row execute function private.notify_post_comment();

drop trigger if exists post_comments_notify_edit on public.post_comments;
create trigger post_comments_notify_edit after update of body on public.post_comments
  for each row when (old.body is distinct from new.body)
  execute function private.notify_post_comment();

revoke all on function private.check_comment_parent() from public, anon, authenticated;
revoke all on function private.user_can_view_post(uuid, uuid) from public, anon, authenticated;
revoke all on function private.comment_mentions(text) from public, anon, authenticated;
revoke all on function private.notify_post_comment() from public, anon, authenticated;
