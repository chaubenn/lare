-- Lare 0032: a per-install secret that pairs the desktop app with the extension.
--
-- The desktop app's local server (127.0.0.1:47831) used to accept any client that sent the
-- extension's Origin header, which only browsers are bound by, and the extension trusted whatever
-- answered on the port. Each desktop install now generates a random secret and publishes it here
-- under the signed-in user. The extension, signed in as the same user, reads it, and on connect
-- each side proves it holds the secret with an HMAC over the other side's fresh nonce (bridge
-- protocol v4, `apps/desktop/src-tauri/src/ws_server.rs`). The secret never crosses the socket.
--
-- One row per (user, install): a user can run the app on several machines. The desktop replaces
-- its secret whenever it signs out, and deletes its row first when the user signs out on purpose.
-- Only the owner can see or change their rows; nothing else in the schema reads them.
--
-- Idempotent: safe to run twice.

create table if not exists public.bridge_secrets (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  install_id uuid not null,
  -- 32 random bytes, hex.
  secret text not null check (secret ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, install_id)
);

drop trigger if exists bridge_secrets_updated_at on public.bridge_secrets;
create trigger bridge_secrets_updated_at before update on public.bridge_secrets
  for each row execute function private.set_updated_at();

alter table public.bridge_secrets enable row level security;
drop policy if exists bridge_secrets_select on public.bridge_secrets;
create policy bridge_secrets_select on public.bridge_secrets for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists bridge_secrets_insert on public.bridge_secrets;
create policy bridge_secrets_insert on public.bridge_secrets for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists bridge_secrets_update on public.bridge_secrets;
create policy bridge_secrets_update on public.bridge_secrets for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists bridge_secrets_delete on public.bridge_secrets;
create policy bridge_secrets_delete on public.bridge_secrets for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.bridge_secrets from anon, authenticated;
grant select, insert, update, delete on public.bridge_secrets to authenticated;
