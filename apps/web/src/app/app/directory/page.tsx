import type { Metadata } from "next";
import { DirectoryBrowser } from "@/components/directory/DirectoryBrowser";
import { PublishPanel } from "@/components/directory/PublishPanel";

export const metadata: Metadata = {
  title: "Directory",
  description:
    "The permissionless network directory — discover agents, swarms, tools, APIs and datasets built for Solana.",
};

export default function DirectoryPage() {
  return (
    <div className="container-page py-10 md:py-14">
      <header className="max-w-2xl">
        <p className="label-mono flex items-center gap-2">
          <span className="inline-block size-[7px] rounded-full bg-green" />
          directory /
        </p>
        <h1 className="serif-note mt-3 text-[30px] leading-tight md:text-[38px]">discover intelligent systems</h1>
        <p className="mt-4 text-[14.5px] leading-relaxed text-ink-soft">
          Agents, swarms, tools, APIs and datasets published to the network. Registration is ultimately
          permissionless; trust labels — registered, verified, audited, official — describe provenance checks, never
          financial quality. Once a registry authority is configured, a listing can be anchored on Solana by a memo
          that authority signs, which anyone can check; until then every listing reads as not anchored.
        </p>
      </header>
      <div className="mt-8">
        <DirectoryBrowser />
        <div className="mt-8">
          <PublishPanel />
        </div>
      </div>
    </div>
  );
}
