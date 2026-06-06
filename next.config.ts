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
  async redirects() {
    return [
      { source: "/alerts", destination: "/decisions", permanent: true },
      { source: "/alerts/:path*", destination: "/decisions/:path*", permanent: true },
      { source: "/watchlist", destination: "/research", permanent: true },
      { source: "/markets", destination: "/research", permanent: true },
      { source: "/tax", destination: "/review", permanent: true },
      { source: "/policy", destination: "/review", permanent: true },
      { source: "/annual-review", destination: "/review", permanent: true },
    ];
  },
};

export default nextConfig;
