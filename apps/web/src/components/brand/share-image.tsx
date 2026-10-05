import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { MARK_ACCENT, YINSI_MARK_NODES } from "./YinsiMark";

/**
 * Code-drawn brand images: the app icons and the share card. Rendered by
 * next/og at build time from the same node list as the in-page mark, so the
 * icon, the card and the nav can never drift apart.
 *
 * Geist ships alongside (SIL Open Font License; copyright and licence URL are
 * in each file's name table). If the files can't be read the images still
 * render, in next/og's default sans.
 */

const INK = "#191b14";
const INK_SOFT = "#43463c";
const GREY = "#6f7268";
const BONE = "#f4f2ea";
const LINE = "#dcd9ca";

type FontEntry = { name: string; data: Buffer; weight: 400 | 600; style: "normal" };

async function loadFont(file: string, name: string, weight: 400 | 600): Promise<FontEntry | null> {
  try {
    const data = await readFile(join(process.cwd(), "src/components/brand/fonts", file));
    return { name, data, weight, style: "normal" };
  } catch {
    return null;
  }
}

async function brandFonts(): Promise<FontEntry[] | undefined> {
  const fonts = await Promise.all([
    loadFont("Geist-Regular.ttf", "Geist", 400),
    loadFont("Geist-SemiBold.ttf", "Geist", 600),
    loadFont("GeistMono-Regular.ttf", "Geist Mono", 400),
  ]);
  const loaded = fonts.filter((font): font is FontEntry => font !== null);
  return loaded.length > 0 ? loaded : undefined;
}

/** The mark as a plain SVG element. `weight` thickens the nodes for tiny icons. */
function Mark({ size, color = INK, weight = 1 }: { size: number; color?: string; weight?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {YINSI_MARK_NODES.map((node) => (
        <circle
          key={`${node.x}-${node.y}`}
          cx={node.x}
          cy={node.y}
          r={node.r * weight}
          fill={node.core ? MARK_ACCENT : color}
        />
      ))}
    </svg>
  );
}

/** App icon: the mark on a bone tile, so it reads on light and dark tab bars alike. */
export function renderIcon(size: number, { radius = 0, scale = 0.7, weight = 1 } = {}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BONE,
          borderRadius: radius,
        }}
      >
        <Mark size={Math.round(size * scale)} weight={weight} />
      </div>
    ),
    { width: size, height: size },
  );
}

/** The corridor from the hero, reduced to its receding frames. */
function Corridor({ width, height }: { width: number; height: number }) {
  const frames: Array<{ d: string; opacity: number }> = [];
  const cx = width / 2;
  const cy = height / 2;
  let w = width * 0.92;
  let h = height * 0.78;
  for (let i = 0; i < 3; i++) {
    const x = cx - w / 2;
    const y = cy - h / 2;
    const c = Math.max(8, 26 * (w / width));
    frames.push({
      d: `M ${x + c} ${y} L ${x + w - c} ${y} L ${x + w} ${y + c} L ${x + w} ${y + h - c} L ${x + w - c} ${y + h} L ${x + c} ${y + h} L ${x} ${y + h - c} L ${x} ${y + c} Z`,
      opacity: Math.max(0.9 - i * 0.12, 0.2),
    });
    w *= 0.8;
    h *= 0.8;
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", top: 0, left: 0 }}>
      {frames.map((frame) => (
        <path key={frame.d} d={frame.d} fill="none" stroke={LINE} strokeWidth={1.2} opacity={frame.opacity} />
      ))}
    </svg>
  );
}

/** The share card used for both Open Graph and X. */
export async function renderShareCard({ width, height }: { width: number; height: number }) {
  const fonts = await brandFonts();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: BONE,
          color: INK,
          fontFamily: "Geist",
          position: "relative",
        }}
      >
        <Corridor width={width} height={height} />
        <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
          <Mark size={112} />
          <div style={{ display: "flex", fontSize: 148, fontWeight: 600, letterSpacing: "-0.045em", lineHeight: 1 }}>
            Yinsi
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 34, fontSize: 36, fontWeight: 400, color: INK_SOFT, letterSpacing: "-0.015em" }}>
          build one agent. coordinate millions.
        </div>
        <div style={{ display: "flex", marginTop: 18, fontFamily: "Geist Mono", fontSize: 21, color: GREY }}>
          autonomous agents and swarms on Solana
        </div>
      </div>
    ),
    { width, height, fonts },
  );
}
