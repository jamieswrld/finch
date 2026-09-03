import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCollections, isDbConfigured } from "@finch/db";
import { REGISTRY_LISTINGS, getRegistryListing, withRunCounts } from "@/lib/registry";
import { ListingDetail } from "@/components/aviary/ListingDetail";

/**
 * Does this listing exist at all?
 *
 * Resolved on the server so an unknown slug returns a real 404 instead of a
 * 200 page that then paints a red "request failed (404)" alert with a retry
 * button that can never succeed — which also taught crawlers that a dead
 * listing URL was healthy.
 *
 * A database that is configured but unreachable is NOT evidence the listing is
 * missing, so that case renders the page and lets the client surface a genuine
 * error. Claiming "not found" on a transport failure would be a lie.
 */
async function listingExists(slug: string): Promise<boolean> {
  if (REGISTRY_LISTINGS.some((entry) => entry.slug === slug)) return true;
  if (!isDbConfigured()) return false;
  try {
    const { aviaryListings } = await getCollections();
    return (await aviaryListings.countDocuments({ slug }, { limit: 1 })) > 0;
  } catch {
    return true;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const listing = REGISTRY_LISTINGS.find((entry) => entry.slug === slug);
  return {
    title: listing ? listing.name : "Listing",
    description: listing?.description ?? "An Aviary listing on the Finch network.",
  };
}

export function generateStaticParams() {
  return REGISTRY_LISTINGS.map((listing) => ({ slug: listing.slug }));
}

export default async function AviaryListingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{2,64}$/.test(slug)) notFound();
  if (!(await listingExists(slug))) notFound();
  return <ListingDetail slug={slug} />;
}
