import { WorldTelemetry } from "./WorldTelemetry";

/**
 * The landing environment: an abstract corridor receding into depth, ambient
 * telemetry at the edges, and a few small agent clusters slowly crossing.
 * Everything extremely pale — atmosphere, not decoration.
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
      <g style={{ animation: "yinsi-corridor-drift 19s ease-in-out infinite", transformOrigin: "720px 348px" }}>
        {frames}
      </g>
      {/* corridor edge rays, with light periodically running down one */}
      <g
        stroke="#00c805"
        strokeWidth="1.2"
        strokeDasharray="34 420"
        opacity="0"
        style={{ animation: "yinsi-ray-sweep 11s linear infinite" }}
      >
        <line x1={outer.x0} y1={outer.y1} x2={inner.x0} y2={inner.y1} />
      </g>
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
      {/* one faint route crossing the corridor */}
      <path
        d="M -40 620 C 320 560, 540 430, 726 352 S 1180 220, 1480 190"
        fill="none"
        stroke="#191b14"
        strokeWidth="1"
        strokeDasharray="2 7"
        opacity="0.14"
        style={{ animation: "yinsi-dash-flow 6s linear infinite" }}
      />
      <circle cx={726} cy={352} r={3} fill="#00c805" style={{ animation: "yinsi-node-pulse 3.4s ease-in-out infinite" }} />
      <circle cx={726} cy={352} r={3} fill="none" stroke="#00c805" strokeWidth="1" style={{ animation: "yinsi-ping 4.6s ease-out infinite" }} />
    </svg>
  );
}

/**
 * The hero swarm. Six small agent clusters crossing at different depths,
 * speeds and angles — far ones small, pale and slow, near ones larger and
 * quicker. The variation is what stops it reading as one sprite looped; a
 * real swarm is never in formation.
 */
const CLUSTERS = [
  { animation: "yinsi-cross-a", duration: "30s", delay: "0s", w: 17, fill: "#191b14" },
  { animation: "yinsi-cross-b", duration: "41s", delay: "9s", w: 11, fill: "#43463c" },
  { animation: "yinsi-cross-c", duration: "52s", delay: "4s", w: 9, fill: "#6f7268" },
  { animation: "yinsi-cross-d", duration: "36s", delay: "17s", w: 14, fill: "#2b2d25" },
  { animation: "yinsi-cross-f", duration: "26s", delay: "12s", w: 20, fill: "#191b14" },
  { animation: "yinsi-cross-g", duration: "58s", delay: "31s", w: 7, fill: "#9b9e93" },
];

/** Three nodes travelling together: a lead and two that keep pace with it. */
function Cluster({ w, fill }: { w: number; fill: string }) {
  return (
    <svg viewBox="0 0 20 14" width={w} height={(w * 14) / 20} fill={fill}>
      <circle cx="14.5" cy="7" r="3.4" />
      <circle cx="6" cy="3.4" r="2.3" />
      <circle cx="4" cy="11" r="1.8" />
    </svg>
  );
}

export function WorldBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <Corridor />

      {CLUSTERS.map((cluster) => (
        <div
          key={cluster.animation}
          className="absolute left-0 top-0 will-change-transform"
          style={{ animation: `${cluster.animation} ${cluster.duration} linear infinite`, animationDelay: cluster.delay }}
        >
          <Cluster w={cluster.w} fill={cluster.fill} />
        </div>
      ))}

      <WorldTelemetry />
    </div>
  );
}
