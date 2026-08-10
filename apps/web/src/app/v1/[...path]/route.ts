import { app } from "@monark/api";

/**
 * Public ingestion API, served by the same Next.js deployment as the dashboard.
 *
 * One project, one deployment. The previous arrangement — a standalone
 * `/api/*` serverless function alongside the dashboard — needed an esbuild
 * bundling step and a hand-written Build Output API config, purely because
 * `@vercel/node` cannot deploy a pnpm workspace whose packages ship raw
 * TypeScript. Next handles that natively via `transpilePackages`, so all of
 * that machinery is gone.
 *
 * The Hono app is unchanged and still routes on the full path, so
 * `app.fetch(request)` behaves identically to the standalone server. Local
 * development can run either.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
