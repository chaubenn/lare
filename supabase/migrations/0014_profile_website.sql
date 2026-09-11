-- Optional website link shown on the profile. Same shape as bio: nullable,
-- length-capped, self-editable under the existing profiles RLS.
alter table public.profiles
  add column if not exists website text check (char_length(website) <= 200);
