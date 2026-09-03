import type { Metadata } from "next";
import { AviaryBrowser } from "@/components/aviary/AviaryBrowser";
import { PublishPanel } from "@/components/aviary/PublishPanel";

export const metadata: Metadata = {
  title: "Aviary",
  description:
    "The permissionless network directory — discover finches, nests, tools, APIs and datasets on Robinhood Chain.",
};

export default function AviaryPage() {
  return (
    <div className="container-page py-10 md:py-14">
      <header className="max-w-2xl">
        <p className="label-mono flex items-center gap-2">
          <span className="inline-block size-[7px] rounded-full bg-green" />
          aviary /
        </p>
        <h1 className="serif-note mt-3 text-[30px] leading-tight md:text-[38px]">discover intelligent systems</h1>
        <p className="mt-4 text-[14.5px] leading-relaxed text-ink-soft">
          Finches, nests, tools, APIs and datasets published to the network. Registration is ultimately
          permissionless; trust labels — registered, verified, audited, official — describe provenance checks, never
          financial quality. Robinhood Chain is the canonical registry; this directory indexes it.
        </p>
      </header>
      <div className="mt-8">
        <AviaryBrowser />
        <div className="mt-8">
          <PublishPanel />
        </div>
      </div>
    </div>
  );
}
