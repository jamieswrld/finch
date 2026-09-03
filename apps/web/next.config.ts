import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@finch/sdk", "@finch/providers", "@finch/flightpath", "@finch/db"],
  serverExternalPackages: ["mongodb"],
  poweredByHeader: false,
  outputFileTracingRoot: path.join(__dirname, "../.."),
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
