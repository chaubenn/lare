import { describe, expect, it } from "vitest";
import { enabledOAuthProviders } from "./auth-providers";

const respond = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("enabledOAuthProviders", () => {
  it("keeps only the providers the project has switched on", async () => {
    const fetchFn = respond({ external: { github: true, google: false, email: true } });
    expect(await enabledOAuthProviders("https://x.supabase.co", "key", fetchFn)).toEqual([
      "github",
    ]);
  });

  it("asks the project's settings endpoint with the publishable key", async () => {
    const calls: { url: string; apikey: string | null }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, apikey: new Headers(init?.headers).get("apikey") });
      return new Response(JSON.stringify({ external: { github: true, google: true } }));
    }) as unknown as typeof fetch;
    expect(await enabledOAuthProviders("https://x.supabase.co/", "key", fetchFn)).toEqual([
      "github",
      "google",
    ]);
    expect(calls).toEqual([{ url: "https://x.supabase.co/auth/v1/settings", apikey: "key" }]);
  });

  it("offers every provider when the settings cannot be read", async () => {
    const all = ["github", "google"];
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await enabledOAuthProviders("https://x.supabase.co", "key", offline)).toEqual(all);
    expect(await enabledOAuthProviders("https://x.supabase.co", "key", respond({}, 404))).toEqual(
      all,
    );
    expect(await enabledOAuthProviders("https://x.supabase.co", "key", respond({}))).toEqual(all);
    expect(await enabledOAuthProviders("https://x.supabase.co", "key", respond(null))).toEqual(all);
  });
});
