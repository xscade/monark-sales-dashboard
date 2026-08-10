import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as enums from "./schema/enums";
import * as org from "./schema/org";
import * as identity from "./schema/identity";
import * as leads from "./schema/leads";
import * as fieldOps from "./schema/field-ops";
import * as conversions from "./schema/conversions";

export const schema = {
  ...enums,
  ...org,
  ...identity,
  ...leads,
  ...fieldOps,
  ...conversions,
};

export type Schema = typeof schema;

/**
 * Supabase gives you three connection strings and they are NOT interchangeable.
 * Picking the wrong one produces failures that look like application bugs, so
 * the distinction is enforced here rather than left to whoever edits `.env`.
 *
 *   Transaction pooler — port 6543, Supavisor.
 *     One pooled connection per *statement*, released immediately. This is the
 *     only sane choice for Vercel: every serverless invocation is a new client,
 *     and Postgres would otherwise run out of backends long before you run out
 *     of traffic. Prepared statements are unavailable in this mode.
 *
 *   Session pooler — port 5432 on the pooler host.
 *     A real session, so DDL and advisory locks work. This is what migrations
 *     use. Note it is the *pooler* host, not `db.<ref>.supabase.co` — direct
 *     connections are IPv6-only on newer Supabase projects, which silently
 *     breaks GitHub Actions and most CI runners.
 *
 *   Direct — port 5432 on db.<ref>.supabase.co.
 *     Only usable from an IPv6-capable network. Avoid unless you know you have
 *     one.
 */
export type ConnectionKind = "pooled" | "direct";

function resolveConnectionString(kind: ConnectionKind): string {
  const pooled = process.env.DATABASE_URL;
  const direct = process.env.DIRECT_URL ?? pooled;

  const url = kind === "direct" ? direct : pooled;
  if (!url) {
    throw new Error(
      kind === "direct"
        ? "DIRECT_URL (or DATABASE_URL) is not set — required for migrations."
        : "DATABASE_URL is not set. Use the Supabase transaction pooler on port 6543.",
    );
  }
  return url;
}

/**
 * Vercel functions are frozen between invocations rather than torn down, so a
 * module-scoped pool survives and is reused across warm requests. Creating a
 * pool per request would open a new TCP + TLS connection to Supavisor every
 * time — the single most common cause of "why is my serverless API slow".
 */
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function poolConfig(connectionString: string, kind: ConnectionKind): PoolConfig {
  return {
    connectionString,
    /**
     * One connection per instance in serverless.
     *
     * A function instance handles one request at a time, so a larger pool buys
     * nothing and costs Supavisor slots. With dozens of concurrent instances
     * a `max: 10` here quietly becomes hundreds of connections and starts
     * returning "max clients reached" under exactly the traffic you wanted to
     * handle.
     */
    max: isServerless ? 1 : kind === "direct" ? 1 : Number(process.env.PG_POOL_MAX ?? 10),

    // Supabase requires TLS. `rejectUnauthorized: false` is the documented
    // setting for the pooler, whose cert chain is not in Node's default store.
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },

    // Keep idle connections short-lived in serverless: the instance may be
    // frozen mid-idle and the server-side connection would otherwise linger.
    idleTimeoutMillis: isServerless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,

    /**
     * The transaction pooler cannot serve named prepared statements, because a
     * statement prepared on one backend is invisible to the next. node-postgres
     * only uses them when a query is explicitly named, and Drizzle only does so
     * via `.prepare()` — so simply never call `.prepare()` in this codebase.
     * Documented here because the failure mode ("prepared statement s1 already
     * exists") is baffling if you have not met it before.
     */
    statement_timeout: kind === "direct" ? 0 : 30_000,
  } as PoolConfig;
}

const pools = new Map<ConnectionKind, Pool>();

export function getPool(kind: ConnectionKind = "pooled"): Pool {
  const existing = pools.get(kind);
  if (existing) return existing;

  const pool = new Pool(poolConfig(resolveConnectionString(kind), kind));

  // An idle-client error (Supavisor recycling a backend, a network blip) is
  // emitted on the pool. Without a handler node-postgres crashes the process.
  pool.on("error", (err) => {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Idle Postgres client error",
        kind,
        error: err.message,
      }),
    );
  });

  pools.set(kind, pool);
  return pool;
}

export function createDb(kind: ConnectionKind = "pooled") {
  return drizzle(getPool(kind), { schema });
}

export type Database = ReturnType<typeof createDb>;

const clients = new Map<ConnectionKind, Database>();

/** Shared connection for app code. Safe to call per request — it is cached. */
export function getDb(kind: ConnectionKind = "pooled"): Database {
  const existing = clients.get(kind);
  if (existing) return existing;
  const db = createDb(kind);
  clients.set(kind, db);
  return db;
}

/**
 * Close every pool.
 *
 * For scripts and long-lived workers. Do NOT call this at the end of a Vercel
 * request handler — the next warm invocation would have to rebuild the pool,
 * defeating the reuse this module exists to provide.
 */
export async function closeDb(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
  clients.clear();
}
