-- Lare 0031: every storage path a row points at is inside its owner's folder.
--
-- Three columns name objects in private buckets: `session_problems.edits_path` (session-data),
-- `videos.thumbnail_path` (thumbnails) and `post_media.storage_path` (post-media). 0025 pinned the
-- first to its owner's folder because `ai-review` reads it with the service role, which ignores
-- storage policies. The other two stayed free text, and `video-delete` removes `thumbnail_path`
-- with the service role: an owner could point their own video at somebody else's poster and have
-- it deleted. `post_media` rows could also be rewritten to another `user_id` or to `kind = 'og'`.
--
--   * `private.is_owned_storage_path(path, owner)` is the one rule: at least two segments, the
--     first is the owner's id, and none is empty, `.` or `..` or contains a backslash. The Edge
--     Functions apply the same rule (`_shared/storage.ts`) before any service-role storage call.
--   * Each path column is checked on insert and whenever the path or its owner changes, for every
--     role. Existing rows are not rewritten or re-checked, so this is safe on a live database; the
--     Edge Functions refuse a bad old path anyway.
--       - thumbnails: `{owner}/{video_id}.{ext}`, the only shape the read policy can serve.
--       - post_media: `{owner}/{post_id}/{file}`, where the owner is the post's author. A row's post
--         and owner cannot change, and the API roles can only write photos (`og` rows were the
--         server's, and nothing writes them any more).
--   * Both buckets' read policies now check the first segment as well: an object is served for a
--     post or video only from that row owner's folder. Uploads already had to be in the
--     uploader's own folder, so every object the apps wrote still qualifies.
--
-- Idempotent: safe to run twice.

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------
create or replace function private.is_owned_storage_path(path text, owner uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    owner is not null
      and split_part(path, '/', 1) = owner::text
      and path ~ '^[^/\\]+(/[^/\\]+)+$'
      and path !~ '(^|/)\.\.?(/|$)',
    false
  );
$$;

revoke all on function private.is_owned_storage_path(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- session_problems.edits_path (0025), now on the shared rule
-- ---------------------------------------------------------------------------
create or replace function private.check_edits_path_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  if new.edits_path is null then
    return new;
  end if;
  select s.user_id into owner from public.sessions s where s.id = new.session_id;
  if not private.is_owned_storage_path(new.edits_path, owner) then
    raise exception 'Edit log path must be inside your own folder' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function private.check_edits_path_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- videos.thumbnail_path
-- ---------------------------------------------------------------------------
create or replace function private.check_video_thumbnail_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.thumbnail_path is not null and not (
    private.is_owned_storage_path(new.thumbnail_path, new.user_id)
    and new.thumbnail_path ~ ('^[^/]+/' || new.id::text || '\.[a-z]+$')
  ) then
    raise exception 'Thumbnail path must be {owner}/{video id}.{ext}' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function private.check_video_thumbnail_path() from public, anon, authenticated;

drop trigger if exists videos_thumbnail_path_owner on public.videos;
create trigger videos_thumbnail_path_owner
  before insert or update of thumbnail_path, user_id on public.videos
  for each row execute function private.check_video_thumbnail_path();

-- ---------------------------------------------------------------------------
-- post_media: owner, post and path
-- ---------------------------------------------------------------------------
create or replace function private.check_post_media_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.post_id is distinct from old.post_id or new.user_id is distinct from old.user_id) then
    raise exception 'A photo cannot be moved to another post or owner' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.posts p where p.id = new.post_id and p.user_id = new.user_id
  ) then
    raise exception 'Post not found' using errcode = '42501';
  end if;
  if not (
    private.is_owned_storage_path(new.storage_path, new.user_id)
    and split_part(new.storage_path, '/', 2) = new.post_id::text
    and split_part(new.storage_path, '/', 3) <> ''
  ) then
    raise exception 'Photo path must be {owner}/{post id}/{file}' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function private.check_post_media_row() from public, anon, authenticated;

drop trigger if exists post_media_row_owner on public.post_media;
create trigger post_media_row_owner
  before insert or update of post_id, user_id, storage_path on public.post_media
  for each row execute function private.check_post_media_row();

-- Not security definer, so `current_user` is the role that ran the statement (as in 0026).
create or replace function private.protect_post_media_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.kind <> 'photo'
     and (tg_op = 'INSERT' or new.kind is distinct from old.kind) then
    raise exception 'Only photos can be added to a post' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function private.protect_post_media_kind() from public, anon, authenticated;

drop trigger if exists post_media_kind on public.post_media;
create trigger post_media_kind
  before insert or update of kind on public.post_media
  for each row execute function private.protect_post_media_kind();

-- ---------------------------------------------------------------------------
-- Read policies check the owner segment
-- ---------------------------------------------------------------------------
-- post-media: `{owner}/{post_id}/{file}` is readable by whoever can read that post, and only when
-- it sits in the post author's folder.
create or replace function private.can_view_post_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parts text[] := storage.foldername(object_name);
begin
  if coalesce(array_length(parts, 1), 0) < 2
     or parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from public.posts p
    where p.id = parts[2]::uuid
      and p.user_id::text = parts[1]
      and private.can_view_post(p)
  );
end $$;

-- thumbnails: `{owner}/{video_id}.{ext}` is readable by whoever can view that video, and only when
-- it sits in the video owner's folder. Before this the filename alone decided.
create or replace function private.can_view_thumbnail_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parts text[] := storage.foldername(object_name);
  file_name text := storage.filename(object_name);
begin
  if coalesce(array_length(parts, 1), 0) <> 1
     or file_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]+$' then
    return false;
  end if;
  return exists (
    select 1 from public.videos v
    where v.id = substring(file_name from 1 for 36)::uuid
      and v.user_id::text = parts[1]
      and private.can_view_video(v.id)
  );
end $$;

-- Storage evaluates the policy as the requesting role.
revoke all on function private.can_view_thumbnail_object(text) from public;
grant execute on function private.can_view_thumbnail_object(text) to anon, authenticated, service_role;

drop policy if exists thumbnails_viewer_select on storage.objects;
create policy thumbnails_viewer_select on storage.objects for select
  using (bucket_id = 'thumbnails' and private.can_view_thumbnail_object(name));
