-- Lare 0007: posts become sharable, editable, social objects.
--
-- Adds
--   * post_media  — the Instagram-style carousel: photos the author attaches to a post,
--                   plus an optional custom cover (the image used instead of the generated
--                   Open Graph card).
--   * post_likes  — one row per (post, liker).
--   * post_comments — flat comments, editable by their author, removable by the author or
--                   the post owner.
--   * posts.like_count / posts.comment_count — denormalised counters kept by triggers so the
--                   feed never needs an aggregate per card.
--   * posts.show_video — whether an attached demo video is shown as a carousel slide.
--   * posts.cover_media_id — optional custom cover image (see post_media).
--   * storage bucket `post-media` — private; readable by anyone who can read the post.
--
-- Visibility is unchanged and still lives in `private.can_view_post`: every new table
-- inherits the post's visibility, so a private post's likes, comments and photos are as
-- private as the post itself.

-- ---------------------------------------------------------------------------
-- Helper: visibility of a post by id (the existing helper takes a whole row)
-- ---------------------------------------------------------------------------
create or replace function private.can_view_post_id(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts p where p.id = pid and private.can_view_post(p));
$$;

create or replace function private.owns_post(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts p where p.id = pid and p.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- post_media
-- ---------------------------------------------------------------------------
create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- storage object path in bucket `post-media`: {user_id}/{post_id}/{uuid}.{ext}
  storage_path text not null,
  width integer,
  height integer,
  caption text check (char_length(caption) <= 280),
  -- quoted: `position` is a col_name_keyword, so the bare form is ambiguous in an index list
  "position" integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists post_media_post_idx
  on public.post_media (post_id, "position", created_at);
create unique index if not exists post_media_path_idx on public.post_media (storage_path);

-- ---------------------------------------------------------------------------
-- posts: counters, the video toggle and the optional custom cover
-- ---------------------------------------------------------------------------
alter table public.posts
  add column if not exists like_count integer not null default 0 check (like_count >= 0),
  add column if not exists comment_count integer not null default 0 check (comment_count >= 0),
  add column if not exists show_video boolean not null default true,
  add column if not exists cover_media_id uuid references public.post_media (id) on delete set null;

comment on column public.posts.show_video is
  'Show the attached demo video as a slide on the post card. Ignored when video_kind = none.';
comment on column public.posts.cover_media_id is
  'Optional custom cover image; when null the generated session card (/api/og/{id}) is used.';

-- ---------------------------------------------------------------------------
-- post_likes
-- ---------------------------------------------------------------------------
create table if not exists public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_likes_user_idx on public.post_likes (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- post_comments
-- ---------------------------------------------------------------------------
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);
create index if not exists post_comments_user_idx on public.post_comments (user_id, created_at desc);

drop trigger if exists post_comments_updated_at on public.post_comments;
create trigger post_comments_updated_at before update on public.post_comments
  for each row execute function private.set_updated_at();

-- An update may only change the body. RLS cannot compare against OLD, so pin the identity
-- columns here: without this a comment could be moved to another post, and the counters below
-- (which only fire on insert and delete) would drift.
create or replace function private.freeze_comment_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  new.id := old.id;
  new.post_id := old.post_id;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists post_comments_freeze on public.post_comments;
create trigger post_comments_freeze before update on public.post_comments
  for each row execute function private.freeze_comment_identity();

-- ---------------------------------------------------------------------------
-- Counter triggers
-- ---------------------------------------------------------------------------
create or replace function private.sync_post_like_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
    return new;
  end if;
  update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  return old;
end $$;

drop trigger if exists post_likes_count on public.post_likes;
create trigger post_likes_count after insert or delete on public.post_likes
  for each row execute function private.sync_post_like_count();

create or replace function private.sync_post_comment_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    return new;
  end if;
  update public.posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
  return old;
end $$;

drop trigger if exists post_comments_count on public.post_comments;
create trigger post_comments_count after insert or delete on public.post_comments
  for each row execute function private.sync_post_comment_count();

-- Backfill (idempotent: safe to re-run).
update public.posts p set
  like_count = coalesce((select count(*) from public.post_likes l where l.post_id = p.id), 0),
  comment_count = coalesce((select count(*) from public.post_comments c where c.post_id = p.id), 0)
where p.like_count is distinct from coalesce((select count(*) from public.post_likes l where l.post_id = p.id), 0)
   or p.comment_count is distinct from coalesce((select count(*) from public.post_comments c where c.post_id = p.id), 0);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.post_media enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;

drop policy if exists post_media_select on public.post_media;
drop policy if exists post_media_insert on public.post_media;
drop policy if exists post_media_update on public.post_media;
drop policy if exists post_media_delete on public.post_media;
create policy post_media_select on public.post_media for select
  using (private.can_view_post_id(post_id));
create policy post_media_insert on public.post_media for insert
  with check (user_id = auth.uid() and private.owns_post(post_id));
create policy post_media_update on public.post_media for update
  using (private.owns_post(post_id)) with check (private.owns_post(post_id));
create policy post_media_delete on public.post_media for delete
  using (private.owns_post(post_id));

drop policy if exists post_likes_select on public.post_likes;
drop policy if exists post_likes_insert on public.post_likes;
drop policy if exists post_likes_delete on public.post_likes;
-- Likers are visible to anyone who can read the post (that is what a like list is).
create policy post_likes_select on public.post_likes for select
  using (private.can_view_post_id(post_id));
create policy post_likes_insert on public.post_likes for insert
  with check (user_id = auth.uid() and private.can_view_post_id(post_id));
create policy post_likes_delete on public.post_likes for delete
  using (user_id = auth.uid());

drop policy if exists post_comments_select on public.post_comments;
drop policy if exists post_comments_insert on public.post_comments;
drop policy if exists post_comments_update on public.post_comments;
drop policy if exists post_comments_delete on public.post_comments;
create policy post_comments_select on public.post_comments for select
  using (private.can_view_post_id(post_id));
create policy post_comments_insert on public.post_comments for insert
  with check (user_id = auth.uid() and private.can_view_post_id(post_id));
-- Authors edit their own comment; the body is the only column the app changes.
create policy post_comments_update on public.post_comments for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Authors delete their own; post owners can also remove comments on their post.
create policy post_comments_delete on public.post_comments for delete
  using (user_id = auth.uid() or private.owns_post(post_id));

grant select, insert, update, delete on public.post_media to authenticated;
grant select on public.post_media to anon;
grant select, insert, delete on public.post_likes to authenticated;
grant select on public.post_likes to anon;
grant select, insert, update, delete on public.post_comments to authenticated;
grant select on public.post_comments to anon;

-- ---------------------------------------------------------------------------
-- Storage: bucket `post-media`
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path is {owner}/{post_id}/{file}; readability follows the post it belongs to.
create or replace function private.can_view_post_object(object_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := storage.foldername(object_name);
begin
  if coalesce(array_length(parts, 1), 0) < 2 then return false; end if;
  if parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.can_view_post_id(parts[2]::uuid);
end $$;

drop policy if exists post_media_owner_all on storage.objects;
drop policy if exists post_media_viewer_select on storage.objects;
create policy post_media_owner_all on storage.objects for all
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy post_media_viewer_select on storage.objects for select
  using (bucket_id = 'post-media' and private.can_view_post_object(name));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- Like / unlike in one round-trip. Security invoker: RLS decides whether the caller may
-- see and therefore like the post.
create or replace function public.toggle_post_like(post uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  liked boolean;
  total integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.post_likes l where l.post_id = post and l.user_id = auth.uid();
  if found then
    liked := false;
  else
    insert into public.post_likes (post_id, user_id) values (post, auth.uid());
    liked := true;
  end if;
  select p.like_count into total from public.posts p where p.id = post;
  return jsonb_build_object('liked', liked, 'like_count', coalesce(total, 0));
end $$;

revoke execute on function public.toggle_post_like(uuid) from anon, public;
grant execute on function public.toggle_post_like(uuid) to authenticated;

-- Re-create `feed` so it is planned against the widened `public.posts` row type.
create or replace function public.feed(
  before timestamptz default null,
  page_size integer default 20,
  scope text default 'all'
)
returns setof public.posts
language sql
stable
security invoker
set search_path = public
as $$
  select p.*
  from public.posts p
  where p.status = 'published'
    and (before is null or p.published_at < before)
    and (
      coalesce(scope, 'all') <> 'following'
      or p.user_id in (
        select f.followee_id
        from public.follows f
        where f.follower_id = auth.uid() and f.status = 'accepted'
      )
    )
  order by p.published_at desc
  limit least(greatest(coalesce(page_size, 20), 1), 50);
$$;

grant execute on function public.feed(timestamptz, integer, text) to anon, authenticated;
grant execute on all functions in schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Realtime (idempotent: `add table` errors when the table is already published)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'post_likes'
  ) then
    alter publication supabase_realtime add table public.post_likes;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'post_comments'
  ) then
    alter publication supabase_realtime add table public.post_comments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'post_media'
  ) then
    alter publication supabase_realtime add table public.post_media;
  end if;
end $$;
