import type { Config } from "drizzle-kit";

/**
 * Migrations run over the SESSION pooler (port 5432 on the pooler host), never
 * the transaction pooler.
 *
 * DDL needs a real session: the transaction pooler hands each statement a
 * different backend, so `CREATE TYPE` followed by `CREATE TABLE ... USING that
 * type` can land on separate connections and fail in ways that look random.
 */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DIRECT_URL is not set. Copy the Supabase **session pooler** string " +
      "(port 5432 on aws-*.pooler.supabase.com) — not the transaction pooler, " +
      "and not db.<ref>.supabase.co, which is IPv6-only.",
  );
}

if (url.includes(":6543")) {
  throw new Error(
    "DIRECT_URL points at the transaction pooler (:6543). Migrations need the " +
      "session pooler (:5432) — DDL requires a stable session.",
  );
}

export default {
  schema: "./src/schema/*.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url, ssl: "require" },
  strict: true,
  verbose: true,
} satisfies Config;
