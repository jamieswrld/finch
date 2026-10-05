import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Load the monorepo-root .env.local.
 *
 * Next reads env files relative to its OWN project root (apps/web), so a
 * developer who follows .env.example and puts keys at the repo root gets a
 * silent no-op: the app boots reporting no provider configured while the file
 * sits right there. One documented location beats two that disagree.
 *
 * Values already present in the environment always win, so this can never
 * override a real deployment variable (Vercel injects those before this runs).
 */
function loadRootEnv(): void {
  const file = path.join(__dirname, "..", "..", ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2];
    if (!key || rawValue === undefined) continue;
    if (process.env[key] !== undefined) continue;
    const value = rawValue.replace(/^["']|["']$/g, "").trim();
    if (value) process.env[key] = value;
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  transpilePackages: ["@finch/sdk", "@finch/providers", "@finch/flightpath", "@finch/db"],
  serverExternalPackages: ["mongodb"],
  poweredByHeader: false,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async headers() {
    // This page connects an injected wallet, so it must not be frameable:
    // a transparent iframe over a lookalike UI is how approval-clickjacking
    // works. The rest are cheap, standard hardening.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },

  async redirects() {
    // The product lives behind /app. Pages were renamed (directory,
    // playground, swarms); every older path still lands on its successor so
    // shared links keep working. Treasury UI removed.
    return [
      { source: "/build", destination: "/app/build", permanent: false },
      { source: "/directory", destination: "/app/directory", permanent: false },
      { source: "/aviary", destination: "/app/directory", permanent: false },
      { source: "/app/aviary", destination: "/app/directory", permanent: false },
      // Two presets were renamed; their old slugs land on the new canonical pages.
      { source: "/app/:dir(aviary|directory)/courier-finch", destination: "/app/directory/courier", permanent: false },
      { source: "/app/:dir(aviary|directory)/developer-finch", destination: "/app/directory/developer-agent", permanent: false },
      { source: "/app/aviary/:slug", destination: "/app/directory/:slug", permanent: false },
      { source: "/swarms", destination: "/app/swarms", permanent: false },
      { source: "/nests", destination: "/app/swarms", permanent: false },
      { source: "/app/nests", destination: "/app/swarms", permanent: false },
      { source: "/flocks", destination: "/app/swarms", permanent: false },
      { source: "/app/flocks", destination: "/app/swarms", permanent: false },
      { source: "/playground", destination: "/app/playground", permanent: false },
      { source: "/school", destination: "/app/playground", permanent: false },
      { source: "/app/school", destination: "/app/playground", permanent: false },
      { source: "/treasury", destination: "/", permanent: false },
      { source: "/app/treasury", destination: "/app", permanent: false },
    ];
  },

  async rewrites() {
    // The API moved to the new names too. Rewrites (not redirects) keep the
    // old paths answering in place, so existing clients — including POSTs,
    // which a redirect would turn into GETs — keep working unchanged.
    return [
      { source: "/api/nests", destination: "/api/swarms" },
      { source: "/api/nests/:path*", destination: "/api/swarms/:path*" },
      { source: "/api/finches", destination: "/api/agents" },
      { source: "/api/aviary", destination: "/api/directory" },
      { source: "/api/aviary/:path*", destination: "/api/directory/:path*" },
      { source: "/api/school/:path*", destination: "/api/playground/:path*" },
      { source: "/api/hive", destination: "/api/memory" },
    ];
  },
};

export default nextConfig;
