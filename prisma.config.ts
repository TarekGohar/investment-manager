import { config as loadEnv } from "dotenv";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Next.js loads .env.local automatically; Prisma CLI does not, so load both
// here so `prisma migrate/generate/studio` all see the same values as `next dev`.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  // Prefer the direct connection for migrations/introspection — pgbouncer
  // (port 6543) runs in transaction mode and doesn't support all DDL.
  datasource: { url: env("DIRECT_URL") },
});
