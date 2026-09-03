import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { Providers } from "@/components/site/Providers";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://finch.fun";
const TITLE = "FINCH — the autonomous agent layer on Robinhood Chain";
const DESCRIPTION =
  "Hatch autonomous agents on Robinhood Chain. Give them memory, models, services and onchain execution. Coordinate them in nests. Every write is simulated, policy-checked and receipted.";

export const metadata: Metadata = {
  // Without metadataBase, Next cannot resolve relative OG image URLs and every
  // share card renders blank.
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · FINCH" },
  description: DESCRIPTION,
  keywords: ["Finch", "Robinhood Chain", "autonomous agents", "EVM", "AI infrastructure", "chain 4663"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "FINCH",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    site: "@finchnests",
    creator: "@finchnests",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${newsreader.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
