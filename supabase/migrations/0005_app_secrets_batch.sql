-- Batch getter so Edge Functions load their configuration with one request.
create or replace function public.get_app_secrets(secret_names text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.name, s.decrypted_secret), '{}'::jsonb)
  from (
    select distinct on (name) name, decrypted_secret
    from vault.decrypted_secrets
    where name = any(secret_names)
    order by name, created_at desc
  ) s
$$;

revoke all on function public.get_app_secrets(text[]) from public;
revoke all on function public.get_app_secrets(text[]) from anon;
revoke all on function public.get_app_secrets(text[]) from authenticated;
grant execute on function public.get_app_secrets(text[]) to service_role;
