import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vercel Build Output API v3 generator.
 *
 * Why this exists rather than letting Vercel's zero-config `/api` handling do
 * the work: `@vercel/node` cannot deploy a pnpm workspace whose packages ship
 * raw TypeScript. It transpiles each file in place and then traces imports, so
 * a package with `"main": "./src/index.ts"` fails two different ways —
 *
 *   main → .ts   the file is compiled to .js, but `main` still points at the
 *                .ts that no longer exists → Cannot find module .../index.ts
 *   main → .js   the .js does not exist when tracing runs, so the package is
 *                never included at all → Cannot find module '@monark/db'
 *
 * The usual fix is to compile every workspace package to `dist/` and repoint
 * `main`. That works, but it means local development can no longer run straight
 * from source — every change needs a build first.
 *
 * Bundling sidesteps both. esbuild resolves and compiles the TypeScript itself,
 * so each function ships as ONE self-contained CommonJS file with no workspace
 * imports left to resolve at runtime. Local dev keeps running from source via
 * tsx, cold starts get smaller, and there is no module resolution left to go
 * wrong in the Lambda.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, ".vercel", "output");

/** Matches the project's configured Node version. */
const RUNTIME = "nodejs22.x";

const FUNCTIONS = [
  { entry: "api/index.ts", route: "api/index", maxDuration: 30 },
  { entry: "api/cron/outbox.ts", route: "api/cron/outbox", maxDuration: 60 },
];

async function buildFunction({ entry, route, maxDuration }) {
  const funcDir = join(outDir, "functions", `${route}.func`);
  await mkdir(funcDir, { recursive: true });

  await build({
    entryPoints: [join(root, entry)],
    outfile: join(funcDir, "index.js"),
    bundle: true,
    platform: "node",
    target: "node22",
    // CommonJS deliberately. Several transitive dependencies (pg, and parts of
    // google-auth-library) still use conditional requires that do not survive
    // being forced into ESM.
    format: "cjs",
    sourcemap: false,
    minify: false,
    // Optional native accelerator for pg. Bundling it would fail on a machine
    // without the native module; pg falls back to pure JS when it is absent.
    external: ["pg-native"],
    logLevel: "warning",
  });

  await writeFile(
    join(funcDir, ".vc-config.json"),
    JSON.stringify(
      {
        runtime: RUNTIME,
        handler: "index.js",
        launcherType: "Nodejs",
        // Vercel's Node launcher supports a Web-standard
        // (Request) => Response default export, which is what both entrypoints
        // export. Helpers are off because we never touch req/res directly.
        shouldAddHelpers: false,
        maxDuration,
      },
      null,
      2,
    ),
  );

  console.log(`  built ${route}.func`);
}

async function main() {
  console.log("Building Vercel output...");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const fn of FUNCTIONS) {
    await buildFunction(fn);
  }

  // Static assets.
  await mkdir(join(outDir, "static"), { recursive: true });
  await cp(join(root, "public"), join(outDir, "static"), { recursive: true });
  console.log("  copied public/ -> static/");

  /**
   * Routing.
   *
   * `handle: filesystem` resolves static files AND function paths, so
   * /api/index and /api/cron/outbox are served without any explicit rule. The
   * rewrites below only exist to give the ingestion endpoint a clean public
   * URL — websites and agencies get /v1/leads, not /api/index.
   */
  await writeFile(
    join(outDir, "config.json"),
    JSON.stringify(
      {
        version: 3,
        routes: [
          {
            src: "^/v1/(.*)$",
            headers: {
              "X-Content-Type-Options": "nosniff",
              "Referrer-Policy": "no-referrer",
              "Cache-Control": "no-store",
            },
            continue: true,
          },
          { handle: "filesystem" },
          { src: "^/health$", dest: "/api/index" },
          { src: "^/v1(?:/.*)?$", dest: "/api/index" },
        ],
      },
      null,
      2,
    ),
  );
  console.log("  wrote config.json");
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
