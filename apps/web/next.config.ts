import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; make sure they go through the compiler.
  transpilePackages: ["@lare/shared", "@lare/ui", "@lare/supabase-types"],
};

export default nextConfig;
