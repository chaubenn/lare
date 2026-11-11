-- Lare 0036: private functions are closed unless a policy needs them, and the API roles cannot
-- create objects in the schemas definer functions search.
--
-- 1. `private` function privileges.
--    0002, 0007 and 0018 ran `grant execute on all functions in schema private to anon,
--    authenticated`, and later migrations revoked one function at a time (0021, 0025, 0026, 0027,
--    0028). Postgres also grants EXECUTE to PUBLIC on every new function. So a new helper was
--    callable by the API roles unless its author remembered the revoke. It only mattered while
--    `private` is not an exposed API schema (see docs/architecture.md, "Settings outside the
--    repo"), but nothing in the repo could show that.
--
--    The API roles only ever need EXECUTE on the helpers that RLS policies call, because policies
--    run as the querying role; triggers and security definer code call the rest as their owner.
--    `private.sync_function_privileges()` derives exactly that from `pg_policies`: it revokes every
--    private function from PUBLIC, anon and authenticated, then grants EXECUTE back to anon and
--    authenticated on each function a policy names. It runs here, and any migration that adds a
--    private function or a policy that calls one ends with `select private.sync_function_privileges();`.
--    The service role's grants are left alone.
--
-- 2. CREATE on `public` and `private`.
--    Most security definer functions run with `set search_path = public` (newer ones use `''` and
--    qualify every name). That is only safe while no untrusted role can create a table, function
--    or operator in `public` that would shadow what the function means. The API roles never need
--    to create objects, so CREATE is revoked from them (and from PUBLIC) on both schemas. A no-op
--    where it was never granted.
--
-- Idempotent: safe to run twice.

revoke create on schema public from public, anon, authenticated;
revoke create on schema private from public, anon, authenticated;

create or replace function private.sync_function_privileges()
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature, p.proname as name
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
    -- Policy expressions are stored deparsed, so a call reads `private.name(...)` (or `name(...)`
    -- for a reader whose search_path includes private). Matching the bare name can only
    -- over-grant a same-named function, never leave a policy without its helper.
    if exists (
      select 1 from pg_catalog.pg_policies pol
      where coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')
        ~ ('(^|[^a-z0-9_])' || fn.name || '\(')
    ) then
      execute format('grant execute on function %s to anon, authenticated', fn.signature);
    end if;
  end loop;
end $$;

revoke all on function private.sync_function_privileges() from public, anon, authenticated;

select private.sync_function_privileges();
