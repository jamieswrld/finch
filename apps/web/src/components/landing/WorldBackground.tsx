import { FINCH_MARK_PATH, FINCH_MARK_VIEWBOX } from "@/components/birds/FinchGlyph";
import { WorldTelemetry } from "./WorldTelemetry";

/**
 * The landing environment: an abstract flight corridor / wind-tunnel receding
 * into depth, ambient Finch telemetry at the edges, and one or two finches
 * slowly crossing. Everything extremely pale — atmosphere, not decoration.
 */

function Corridor() {
  const frames: React.ReactNode[] = [];
  const cx = 720;
  const cy = 348;
  let width = 1560;
  let height = 700;
  const corners: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  for (let i = 0; i < 9; i++) {
    const x = cx - width / 2;
    const y = cy - height / 2;
    const chamfer = Math.max(10, 34 * (width / 1560));
    const opacity = 0.095 - i * 0.0075;
    frames.push(
      <path
        key={i}
        d={`M ${x + chamfer} ${y} L ${x + width - chamfer} ${y} L ${x + width} ${y + chamfer} L ${x + width} ${y + height - chamfer} L ${x + width - chamfer} ${y + height} L ${x + chamfer} ${y + height} L ${x} ${y + height - chamfer} L ${x} ${y + chamfer} Z`}
        fill="none"
        stroke="#191b14"
        strokeWidth={i === 0 ? 1.2 : 1}
        opacity={Math.max(opacity, 0.02)}
      />,
    );
    if (i === 0 || i === 8) corners.push({ x0: x, y0: y, x1: x + width, y1: y + height });
    width *= 0.795;
    height *= 0.795;
  }

  const outer = corners[0]!;
  const inner = corners[1]!;

  return (
    <svg
      viewBox="0 0 1440 780"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      {frames}
      {/* corridor edge rays */}
      <g stroke="#191b14" strokeWidth="1" opacity="0.045">
        <line x1={outer.x0} y1={outer.y0} x2={inner.x0} y2={inner.y0} />
        <line x1={outer.x1} y1={outer.y0} x2={inner.x1} y2={inner.y0} />
        <line x1={outer.x0} y1={outer.y1} x2={inner.x0} y2={inner.y1} />
        <line x1={outer.x1} y1={outer.y1} x2={inner.x1} y2={inner.y1} />
      </g>
      {/* floor convergence */}
      <g stroke="#191b14" strokeWidth="1" opacity="0.035">
        <line x1="80" y1="780" x2={cx - 60} y2={cy + 120} />
        <line x1="420" y1="780" x2={cx - 24} y2={cy + 124} />
        <line x1="1020" y1="780" x2={cx + 24} y2={cy + 124} />
        <line x1="1360" y1="780" x2={cx + 60} y2={cy + 120} />
      </g>
      {/* one faint crossing flightpath through the corridor */}
      <path
        d="M -40 620 C 320 560, 540 430, 726 352 S 1180 220, 1480 190"
        fill="none"
        stroke="#191b14"
        strokeWidth="1"
        strokeDasharray="2 7"
        opacity="0.14"
      />
      <circle cx={726} cy={352} r={3} fill="#00c805" opacity="0.7" />
    </svg>
  );
}

/**
 * The hero nest. Seven finches crossing at different depths, speeds and
 * angles — far ones small, pale and slow, near ones larger and quicker. The
 * variation is what stops it reading as one sprite looped; a real nest is
 * never in formation.
 */
const FLOCK = [
  { animation: "finch-cross-a", duration: "30s", delay: "0s", w: 17, h: 14, fill: "#191b14" },
  { animation: "finch-cross-b", duration: "41s", delay: "9s", w: 11, h: 9, fill: "#43463c" },
  { animation: "finch-cross-c", duration: "52s", delay: "4s", w: 9, h: 7, fill: "#6f7268" },
  { animation: "finch-cross-d", duration: "36s", delay: "17s", w: 14, h: 11, fill: "#2b2d25" },
  { animation: "finch-cross-e", duration: "63s", delay: "23s", w: 8, h: 6, fill: "#9b9e93" },
  { animation: "finch-cross-f", duration: "26s", delay: "12s", w: 20, h: 16, fill: "#191b14" },
  { animation: "finch-cross-g", duration: "58s", delay: "31s", w: 7, h: 6, fill: "#9b9e93" },
];

export function WorldBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <Corridor />

      {FLOCK.map((bird) => (
        <div
          key={bird.animation}
          className="absolute left-0 top-0 will-change-transform"
          style={{ animation: `${bird.animation} ${bird.duration} linear infinite`, animationDelay: bird.delay }}
        >
          <svg viewBox={FINCH_MARK_VIEWBOX} width={bird.w} height={bird.h} fill={bird.fill}>
            <path d={FINCH_MARK_PATH} />
          </svg>
        </div>
      ))}

      <WorldTelemetry />
    </div>
  );
}
