import type { MetadataRoute } from "next";
import { seedAviaryListings } from "@finch/db/seeds";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://finch.fun";

/** Only routes that actually exist on disk — a sitemap of 404s is worse than none. */
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    { path: "", priority: 1 },
    { path: "/how-it-works", priority: 0.8 },
    { path: "/docs", priority: 0.7 },
    { path: "/research", priority: 0.5 },
    { path: "/app", priority: 0.9 },
    { path: "/app/school", priority: 0.8 },
    { path: "/app/aviary", priority: 0.8 },
    { path: "/app/nests", priority: 0.8 },
    { path: "/app/network", priority: 0.6 },
    { path: "/app/build", priority: 0.6 },
  ];

  const listings = seedAviaryListings.map((listing) => ({
    url: `${SITE_URL}/app/aviary/${listing.slug}`,
    changeFrequency: "weekly" as const,
    priority: 0.4,
  }));

  return [
    ...routes.map((route) => ({
      url: `${SITE_URL}${route.path}`,
      changeFrequency: "weekly" as const,
      priority: route.priority,
    })),
    ...listings,
  ];
}
