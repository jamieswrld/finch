import { renderIcon } from "@/components/brand/share-image";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: full-bleed bone (the OS applies its own corner mask). */
export default function AppleIcon() {
  return renderIcon(size.width, { scale: 0.62, weight: 1.05 });
}
