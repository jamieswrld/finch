import { renderIcon } from "@/components/brand/share-image";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Browser icon: the mark on a rounded bone tile. Nodes thickened for 16px tabs. */
export default function Icon() {
  return renderIcon(size.width, { radius: 14, scale: 0.78, weight: 1.15 });
}
