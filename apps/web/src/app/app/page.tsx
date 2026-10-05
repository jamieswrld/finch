import type { Metadata } from "next";
import { AppHome } from "@/components/app/AppHome";

export const metadata: Metadata = {
  title: "Overview",
  description: "Yinsi mission control — your agents, the directory, swarms and live chain state at a glance.",
};

export default function AppOverviewPage() {
  return <AppHome />;
}
