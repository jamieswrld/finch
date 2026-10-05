import { Footer } from "@/components/site/Footer";
import { FinalCta } from "@/components/home/FinalCta";
import { ExecutionSection } from "@/components/home/ExecutionSection";
import { SdkSection } from "@/components/home/SdkSection";
import { SwarmBand } from "@/components/landing/SwarmBand";
import { World } from "@/components/landing/World";
import { OneAgentSection, SwarmMeshSection, SwarmSection } from "@/components/landing/sections";

/**
 * The landing page — the world first, then the story:
 * one → specialize → coordinate → swarm → connect → network
 */
export default function LandingPage() {
  return (
    <>
      <World />
      <main>
        <SwarmBand />
        <OneAgentSection />
        <SwarmSection />
        <SwarmMeshSection />
        <SdkSection />
        <ExecutionSection />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
