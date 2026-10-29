-- Lare 0008: mark the pre-generated session card on post_media.
--
-- `kind` separates author-attached photos from the OG card that the og-snapshot Edge Function
-- stores for every published post (one per post, enforced by the partial unique index).
-- Safe to re-run; on a fresh database 0007 already creates the column and this is a no-op.

alter table public.post_media
  add column if not exists kind text not null default 'photo' check (kind in ('photo', 'og'));

create unique index if not exists post_media_og_idx
  on public.post_media (post_id) where kind = 'og';

comment on column public.post_media.kind is
  'photo: attached by the author. og: the pre-generated session card written by og-snapshot.';
