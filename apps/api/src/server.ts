import { serve } from "@hono/node-server";
import app from "./app";

/**
 * Local development server.
 *
 * Production runs on Vercel, where `api/index.ts` exports the same Hono app as
 * a serverless handler. Keeping the app definition free of any server binding
 * is what lets one codebase serve both without a build-time branch.
 */
const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, () => {
  console.log(`monark-api listening on http://localhost:${port}`);
});
