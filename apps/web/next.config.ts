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
    // The product lives behind /app. "Flock" was retired as a public noun in
    // favour of "nest", so the old paths still resolve; treasury UI removed.
    return [
      { source: "/build", destination: "/app/build", permanent: false },
      { source: "/aviary", destination: "/app/aviary", permanent: false },
      { source: "/nests", destination: "/app/nests", permanent: false },
      { source: "/flocks", destination: "/app/nests", permanent: false },
      { source: "/app/flocks", destination: "/app/nests", permanent: false },
      { source: "/treasury", destination: "/", permanent: false },
      { source: "/app/treasury", destination: "/app", permanent: false },
      { source: "/school", destination: "/app/school", permanent: false },
    ];
  },
};

export default nextConfig;
