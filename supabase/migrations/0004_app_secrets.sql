-- Server-side configuration for Edge Functions stored in Supabase Vault.
--
-- Edge Functions read `Deno.env` first and fall back to `get_app_secret()` (see
-- supabase/functions/_shared/http.ts). Only the service role may call it; anon and
-- authenticated users get "permission denied".

create extension if not exists supabase_vault with schema vault;

create or replace function public.get_app_secret(secret_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name = secret_name
  order by s.created_at desc
  limit 1
$$;

revoke all on function public.get_app_secret(text) from public;
revoke all on function public.get_app_secret(text) from anon;
revoke all on function public.get_app_secret(text) from authenticated;
grant execute on function public.get_app_secret(text) to service_role;

-- Upsert helper used when rotating values (service role only).
create or replace function public.set_app_secret(secret_name text, secret_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = secret_name order by created_at desc limit 1;
  if existing is null then
    perform vault.create_secret(secret_value, secret_name);
  else
    perform vault.update_secret(existing, secret_value, secret_name);
  end if;
end;
$$;

revoke all on function public.set_app_secret(text, text) from public;
revoke all on function public.set_app_secret(text, text) from anon;
revoke all on function public.set_app_secret(text, text) from authenticated;
grant execute on function public.set_app_secret(text, text) to service_role;
