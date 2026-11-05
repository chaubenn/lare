-- Lare 0026: the columns of a post the server owns can only be written by the server.
--
-- `posts_update` lets an owner update any column of their own post, and `posts_insert` any column
-- of a new one. Several of those columns are not the author's to set:
--   * like_count / comment_count — kept by the counter triggers (0007); writable, they let an
--     author show any number of likes or comments.
--   * published_at — feeds and profiles order by it, and 0018 moves it to "now" when the last
--     video a post waits on is ready. Writable, it pins a post to the top of every feed forever
--     (any future date) or backdates it. The desktop app also sent its own clock when publishing,
--     and a second "publish" (a double click, a retry) bumped an already published post.
--   * slug, id, created_at — the public handle and identity of the post.
--   * user_id, session_id — who and what the post is about. 0020 checks they belong to the
--     author; pinning them also stops a post being swapped onto another of the author's sessions,
--     and session_id is the conflict key the extension's finalize upsert relies on.
--
-- The rule is applied to the API roles only (`anon`, `authenticated`). The trigger function is
-- deliberately *not* security definer, so `current_user` is the role that ran the statement:
-- Edge Functions (service_role), the definer RPCs and triggers (their owner), and foreign-key
-- actions such as `on delete set null` (the table owner) are unaffected.
--
-- Status and published_at:
--   * draft -> published (or a client insert straight as published): published_at := now().
--   * published -> published: published_at is kept, so re-publishing never bumps a post.
--   * published -> draft: ignored here (the post stays published); it goes through
--     `unpublish_post` below. The extension's finalize retry upserts `status: 'draft'` on
--     conflict, and before this a late retry silently unpublished the post. Raising instead
--     would trap released extensions in an endless retry, so the status is quietly kept.
--   * draft -> draft: published_at stays null.
--
-- Idempotent: safe to run twice.

create or replace function private.protect_post_server_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.like_count := 0;
    new.comment_count := 0;
    new.created_at := now();
    new.slug := public.unique_post_slug();
    new.published_at := case when new.status = 'published' then now() else null end;
    return new;
  end if;

  new.id := old.id;
  new.user_id := old.user_id;
  new.session_id := old.session_id;
  new.slug := old.slug;
  new.created_at := old.created_at;
  new.like_count := old.like_count;
  new.comment_count := old.comment_count;

  -- Kept published rather than refused: extensions already released re-send `status: 'draft'`
  -- on a finalize retry, and an error there would leave them retrying forever.
  if old.status = 'published' and new.status = 'draft' then
    new.status := old.status;
  end if;

  if old.status = 'draft' and new.status = 'published' then
    new.published_at := now();
  else
    new.published_at := old.published_at;
  end if;
  return new;
end $$;

revoke all on function private.protect_post_server_columns() from public, anon, authenticated;

-- Named so it sorts before `posts_references_owner` (0020): triggers fire alphabetically, and the
-- ownership check should see the pinned user_id / session_id.
drop trigger if exists posts_protect_server_columns on public.posts;
create trigger posts_protect_server_columns before insert or update on public.posts
  for each row execute function private.protect_post_server_columns();

-- ---------------------------------------------------------------------------
-- unpublish_post(p_post_id) -> back to draft
-- ---------------------------------------------------------------------------
-- The caller's own published post, pending ones included (0018: "pending" is a published post
-- whose videos are not ready yet), goes back to draft and loses its published_at; publishing it
-- again stamps a fresh one. Likes and comments stay. Already a draft: nothing to do.
-- Definer so it can clear published_at past the trigger above; the owner check is the gate.
create or replace function public.unpublish_post(p_post_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_status public.post_status;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select status into current_status
  from public.posts
  where id = p_post_id and user_id = uid
  for update;
  if not found then
    raise exception 'Post not found' using errcode = 'P0002';
  end if;
  if current_status = 'draft' then
    return;
  end if;

  update public.posts
  set status = 'draft', published_at = null
  where id = p_post_id;
end $$;

revoke execute on function public.unpublish_post(uuid) from public, anon;
grant execute on function public.unpublish_post(uuid) to authenticated;
