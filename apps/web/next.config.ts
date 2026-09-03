import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; make sure they go through the compiler.
  transpilePackages: ["@lare/shared", "@lare/ui", "@lare/supabase-types"],
  // isomorphic-dompurify pulls in jsdom on the server; keep it out of the bundle.
  serverExternalPackages: ["isomorphic-dompurify"],
};

export default nextConfig;
