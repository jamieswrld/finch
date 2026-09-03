import { Footer } from "@/components/site/Footer";
import { FinalCta } from "@/components/home/FinalCta";
import { FlightpathSection } from "@/components/home/FlightpathSection";
import { SdkSection } from "@/components/home/SdkSection";
import { TokenSection } from "@/components/home/TokenSection";
import { SwarmBand } from "@/components/landing/SwarmBand";
import { World } from "@/components/landing/World";
import { NestMeshSection, NestSection, OneFinchSection } from "@/components/landing/sections";

/**
 * finch.fun — the world first, then the story:
 * ONE → SPECIALIZE → COORDINATE → NEST → CONNECT → NETWORK
 */
export default function LandingPage() {
  return (
    <>
      <World />
      <main>
        <SwarmBand />
        <OneFinchSection />
        <NestSection />
        <NestMeshSection />
        <TokenSection />
        <SdkSection />
        <FlightpathSection />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
