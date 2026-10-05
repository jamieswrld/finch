import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/site/Providers";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://finch.fun";
const TITLE = "Yinsi — the autonomous agent layer on Solana";
const DESCRIPTION =
  "Launch autonomous agents on Solana. Give them memory, models, services and onchain execution. Coordinate them in swarms. Every write is policy-checked, simulated and signed by you or a bounded key.";

export const metadata: Metadata = {
  // Without metadataBase, Next cannot resolve relative OG image URLs and every
  // share card renders blank.
  metadataBase: new URL(SITE_URL),
  applicationName: "Yinsi",
  title: { default: TITLE, template: "%s · Yinsi" },
  description: DESCRIPTION,
  keywords: ["Yinsi", "Solana", "autonomous agents", "AI agents", "agent swarms", "AI infrastructure", "SPL tokens"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Yinsi",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
