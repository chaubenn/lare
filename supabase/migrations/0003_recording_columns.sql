-- Recording-related columns used by the desktop app and Edge Functions.
alter table public.sessions
  add column if not exists recording_started_at timestamptz; -- media time 0 (epoch) for transcript/edit alignment

alter table public.videos
  add column if not exists session_id uuid references public.sessions (id) on delete set null,
  add column if not exists title text;

create index if not exists videos_session_idx on public.videos (session_id);

-- Interview reviews are written by the ai-review Edge Function (service role); owners may
-- also request regeneration, which deletes the previous row first (policy exists).
