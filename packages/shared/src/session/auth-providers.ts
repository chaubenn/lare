/** The OAuth sign-in providers the desktop app and the extension have a button for. */
export const OAUTH_PROVIDERS = ["github", "google"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  github: "GitHub",
  google: "Google",
};

/**
 * Which of `OAUTH_PROVIDERS` the Supabase project has switched on, read from its public
 * `/auth/v1/settings`.
 *
 * The sign-in URL of a provider that is off answers with a JSON error in the browser and never
 * redirects back, so the client that opened it waits for a callback that cannot come. Nothing on
 * the client side can tell that apart from someone still typing their password, which is why the
 * button is not offered in the first place.
 *
 * Resolves to every provider when the settings cannot be read (offline, an unexpected body): a
 * button that may fail beats no way in.
 */
export async function enabledOAuthProviders(
  supabaseUrl: string,
  publishableKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<OAuthProvider[]> {
  try {
    const res = await fetchFn(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/settings`, {
      headers: { apikey: publishableKey },
    });
    if (!res.ok) return [...OAUTH_PROVIDERS];
    const body: unknown = await res.json();
    const external = (body as { external?: unknown } | null)?.external;
    if (typeof external !== "object" || external === null) return [...OAUTH_PROVIDERS];
    const flags = external as Record<string, unknown>;
    return OAUTH_PROVIDERS.filter((provider) => flags[provider] === true);
  } catch {
    return [...OAUTH_PROVIDERS];
  }
}
