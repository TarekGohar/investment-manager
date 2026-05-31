import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Better Auth + its kysely adapter + Prisma all use dynamic Node patterns
  // and shouldn't be bundled by Turbopack. Keep them external so they're
  // resolved via Node's runtime require() at request time.
  serverExternalPackages: [
    "better-auth",
    "@better-auth/kysely-adapter",
    "kysely",
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "yahoo-finance2",
    "openai",
  ],
};

export default nextConfig;
