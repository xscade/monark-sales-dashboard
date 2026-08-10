import { handle } from "hono/vercel";
import app from "../apps/api/src/app";

/**
 * Vercel serverless entry point.
 *
 * `vercel.json` rewrites every path here, so Hono keeps doing the routing and
 * the deployment stays a single function rather than one per endpoint — which
 * matters because each distinct function gets its own cold start and its own
 * connection pool to Supabase.
 */
export const config = {
  runtime: "nodejs",
};

export default handle(app);
