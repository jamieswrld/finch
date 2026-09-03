import type { Metadata } from "next";
import { AppHome } from "@/components/app/AppHome";

export const metadata: Metadata = {
  title: "Overview",
  description: "Finch mission control — your finches, the Aviary, nests and live chain state at a glance.",
};

export default function AppOverviewPage() {
  return <AppHome />;
}
