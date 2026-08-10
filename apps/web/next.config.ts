import type { NextConfig } from "next";
import { join } from "node:path";

const config: NextConfig = {
  /**
   * Pin the workspace root explicitly.
   *
   * Next walks upward looking for a lockfile and had been picking up an
   * unrelated `package-lock.json` in the parent directory, which makes file
   * tracing collect the wrong tree — harmless locally, quietly broken once
   * deployed.
   */
  outputFileTracingRoot: join(__dirname, "../../"),

  /**
   * The workspace packages ship raw TypeScript rather than compiled JS.
   *
   * Next handles that natively with `transpilePackages` — which is precisely
   * the problem that made the standalone API deployment so painful, since
   * `@vercel/node` has no equivalent and had to be worked around with an
   * esbuild bundling step. Here it is one line.
   */
  transpilePackages: ["@monark/core", "@monark/db", "@monark/services", "@monark/api"],

  serverExternalPackages: ["pg"],

  eslint: { ignoreDuringBuilds: true },

  async headers() {
    return [
      {
        // Ingestion responses carry lead identifiers — never cache them, and
        // never let a referrer leak the URL.
        source: "/v1/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },

  experimental: {
    // Server Actions handle every mutation in this app; the default 1MB body
    // limit is generous for form posts but not for CSV lead imports.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default config;
