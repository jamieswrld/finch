import { renderShareCard } from "@/components/brand/share-image";

export const alt = "Yinsi — the autonomous agent layer on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return renderShareCard(size);
}
