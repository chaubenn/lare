import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; make sure they go through the compiler.
  transpilePackages: ["@lare/shared", "@lare/ui", "@lare/supabase-types"],
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
