import type { Metadata } from "next";
import { SchoolConsole } from "@/components/school/SchoolConsole";

export const metadata: Metadata = {
  title: "Flight School",
  description: "Try a real finch in under a minute — read-only presets on the live Finch runtime, no wallet required.",
};

export default function FlightSchoolPage() {
  return (
    <div className="container-page py-10 md:py-14">
      <header className="max-w-2xl">
        <p className="label-mono flex items-center gap-2">
          <span className="inline-block size-[7px] rounded-full bg-green" />
          flight school /
        </p>
        <h1 className="serif-note mt-3 text-[30px] leading-tight md:text-[38px]">
          what should your first finch learn?
        </h1>
      </header>
      <div className="mt-8">
        <SchoolConsole />
      </div>
    </div>
  );
}
