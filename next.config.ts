import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "@node-rs/argon2", "ws"],
};

export default nextConfig;
