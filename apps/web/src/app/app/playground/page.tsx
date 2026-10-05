import type { Metadata } from "next";
import { PlaygroundConsole } from "@/components/playground/PlaygroundConsole";

export const metadata: Metadata = {
  title: "Playground",
  description: "Try a real agent in under a minute — read-only presets on the live Yinsi runtime, no wallet required.",
};

export default function PlaygroundPage() {
  return (
    <div className="container-page py-10 md:py-14">
      <header className="max-w-2xl">
        <p className="label-mono flex items-center gap-2">
          <span className="inline-block size-[7px] rounded-full bg-green" />
          playground /
        </p>
        <h1 className="serif-note mt-3 text-[30px] leading-tight md:text-[38px]">
          what should your first agent learn?
        </h1>
      </header>
      <div className="mt-8">
        <PlaygroundConsole />
      </div>
    </div>
  );
}
