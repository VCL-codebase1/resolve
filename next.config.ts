import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "@node-rs/argon2", "ws"],
  outputFileTracingIncludes: {
    "/api/v1/**": ["./schema.sql", "./migrations/002_sso.sql"],
  },
};

export default nextConfig;
