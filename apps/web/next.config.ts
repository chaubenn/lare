import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; make sure they go through the compiler.
  transpilePackages: ["@lare/shared", "@lare/ui", "@lare/supabase-types"],
  experimental: {
    // Every page here reads cookies, so every route is dynamic, and a dynamic route's
    // client cache is off by default (`dynamic: 0`). That made each navigation — including
    // going back — a fresh server round trip for a page the browser had just rendered.
    // 30s is short enough that a stale feed is a non-issue, and mutations don't rely on it
    // expiring: server actions call `revalidatePath` and the client ones `router.refresh()`,
    // both of which drop the entry immediately.
    staleTimes: { dynamic: 30, static: 300 },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.b-cdn.net" },
      { protocol: "https", hostname: "player.mediadelivery.net" },
      { protocol: "https", hostname: "*.bunnycdn.com" },
    ],
  },
};

export default nextConfig;
