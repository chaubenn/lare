-- Per-user grading criteria for the AI interview review. One private row per user; no row means
-- the review uses the built-in default criteria (DEFAULT_REVIEW_CRITERIA in packages/shared and
-- supabase/functions/_shared/reviewCriteria.ts). The ai-review function reads it with the
-- service role, so the owner only needs to read and write their own row.
create table if not exists public.review_criteria (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  criteria text not null check (char_length(btrim(criteria)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists review_criteria_updated_at on public.review_criteria;
create trigger review_criteria_updated_at before update on public.review_criteria
  for each row execute function private.set_updated_at();

alter table public.review_criteria enable row level security;
drop policy if exists review_criteria_select on public.review_criteria;
create policy review_criteria_select on public.review_criteria for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists review_criteria_insert on public.review_criteria;
create policy review_criteria_insert on public.review_criteria for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists review_criteria_update on public.review_criteria;
create policy review_criteria_update on public.review_criteria for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists review_criteria_delete on public.review_criteria;
create policy review_criteria_delete on public.review_criteria for delete to authenticated
  using (user_id = (select auth.uid()));
