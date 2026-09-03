/**
 * Mechanism diagrams. Each one draws the actual control flow implemented in
 * the packages — not decoration. Monochrome ink on bone, one green accent,
 * scientific-plot register.
 */

const INK = "#191b14";
const GREY = "#6f7268";
const FAINT = "#c2bfae";
const GREEN = "#0a7227";
const SAGE = "#67765e";

function Label({ x, y, children, anchor = "middle", color = GREY, size = 8.5 }: {
  x: number;
  y: number;
  children: string;
  anchor?: "start" | "middle" | "end";
  color?: string;
  size?: number;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontFamily="var(--font-geist-mono), monospace"
      fontSize={size}
      fill={color}
      letterSpacing="0.06em"
    >
      {children}
    </text>
  );
}

function Box({ x, y, w, h, label, sub, accent }: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={2} fill="#faf9f4" stroke={accent ? GREEN : FAINT} strokeWidth="1" />
      <Label x={x + w / 2} y={y + (sub ? h / 2 - 1 : h / 2 + 3)} color={accent ? GREEN : INK} size={9}>
        {label}
      </Label>
      {sub && (
        <Label x={x + w / 2} y={y + h / 2 + 10} color={GREY} size={7.5}>
          {sub}
        </Label>
      )}
    </g>
  );
}

function Arrow({ from, to, label, dashed }: {
  from: [number, number];
  to: [number, number];
  label?: string;
  dashed?: boolean;
}) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 4.5;
  return (
    <g stroke={SAGE} fill={SAGE}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="1" strokeDasharray={dashed ? "3 3" : undefined} />
      <path
        d={`M ${x2} ${y2} L ${x2 - head * Math.cos(angle - 0.4)} ${y2 - head * Math.sin(angle - 0.4)} L ${x2 - head * Math.cos(angle + 0.4)} ${y2 - head * Math.sin(angle + 0.4)} Z`}
        stroke="none"
      />
      {label && (
        <text
          x={(x1 + x2) / 2}
          y={(y1 + y2) / 2 - 4}
          textAnchor="middle"
          fontFamily="var(--font-geist-mono), monospace"
          fontSize="7.5"
          fill={SAGE}
          stroke="none"
        >
          {label}
        </text>
      )}
    </g>
  );
}

function Frame({ children, viewBox, caption }: { children: React.ReactNode; viewBox: string; caption: string }) {
  return (
    <figure className="grid-paper overflow-x-auto rounded-xs border border-line bg-bone-raised p-4">
      <svg viewBox={viewBox} className="h-auto w-full min-w-[560px]" role="img" aria-label={caption}>
        {children}
      </svg>
      <figcaption className="mt-3 font-mono text-[9.5px] text-grey-faint">{caption}</figcaption>
    </figure>
  );
}

/** The finch runtime loop, as implemented in packages/sdk/src/runtime.ts. */
export function FinchLoopDiagram() {
  return (
    <Frame viewBox="0 0 720 220" caption="fig. 01 — the finch runtime loop (packages/sdk/src/runtime.ts)">
      <Box x={16} y={86} w={96} h={44} label="finch.json" sub="manifest" />
      <Arrow from={[116, 108]} to={[152, 108]} label="hatch" />
      <Box x={156} y={86} w={92} h={44} label="Nest" sub="bound runtime" accent />
      <Arrow from={[252, 108]} to={[292, 108]} />

      <rect x={296} y={30} width={272} height={158} rx={2} fill="none" stroke={FAINT} strokeDasharray="3 3" />
      <Label x={432} y={24} color={GREY}>run loop — bounded by budget.maxToolStepsPerRun</Label>

      <Box x={312} y={48} w={104} h={40} label="recall memory" sub="vector or none" />
      <Arrow from={[364, 92]} to={[364, 114]} />
      <Box x={312} y={118} w={104} h={40} label="model call" sub="provider abstraction" />
      <Arrow from={[420, 138]} to={[452, 138]} label="tool calls" />
      <Box x={456} y={118} w={100} h={40} label="tool step" sub="policy-checked" />
      <Arrow from={[506, 114]} to={[506, 92]} />
      <Box x={456} y={48} w={100} h={40} label="observation" sub="fed back" />
      <Arrow from={[452, 68]} to={[420, 68]} dashed />

      <Arrow from={[572, 108]} to={[606, 108]} label="no tool calls" />
      <Box x={610} y={72} w={96} h={34} label="output" accent />
      <Box x={610} y={112} w={96} h={34} label="steps + usage" />
      <Label x={658} y={162} color={GREY} size={7.5}>
        kill switch on N consecutive failures
      </Label>
    </Frame>
  );
}

/** DAG scheduling, as implemented in packages/sdk/src/nest.ts runNest(). */
export function NestSchedulerDiagram() {
  return (
    <Frame viewBox="0 0 720 250" caption="fig. 02 — nest scheduling: dependency waves and typed channels (packages/sdk/src/nest.ts)">
      <Label x={70} y={20} color={GREY}>stage 01</Label>
      <Label x={270} y={20} color={GREY}>stage 02 — parallel</Label>
      <Label x={500} y={20} color={GREY}>stage 03</Label>
      <Label x={650} y={20} color={GREY}>coordinator</Label>

      <Box x={20} y={92} w={104} h={46} label="network-scout" sub="task t1" />
      <Arrow from={[128, 104]} to={[200, 68]} label="chain.status" />
      <Arrow from={[128, 126]} to={[200, 162]} label="chain.status" />

      <Box x={204} y={44} w={104} h={46} label="block-analyst" sub="task t2" />
      <Box x={204} y={140} w={104} h={46} label="cost-analyst" sub="task t3" />

      <Arrow from={[312, 68]} to={[400, 100]} label="block.profile" />
      <Arrow from={[312, 162]} to={[400, 132]} label="cost.profile" />

      <Box x={404} y={92} w={104} h={46} label="risk-finch" sub="task t4" />
      <Arrow from={[512, 115]} to={[576, 115]} label="risk.assessment" />
      <Box x={580} y={92} w={116} h={46} label="synthesis" sub="terminal channels" accent />

      <line x1={16} y1={214} x2={704} y2={214} stroke={FAINT} strokeWidth="1" strokeDasharray="2 4" />
      <Label x={16} y={230} anchor="start" color={GREY} size={7.5}>
        a task runs only when every dependency has published its channel · a wave is bounded by maxParallel
      </Label>
      <Label x={704} y={230} anchor="end" color={GREEN} size={7.5}>
        failure → downstream skipped, never fabricated
      </Label>
    </Frame>
  );
}

/** The mandatory write lifecycle, as implemented in flightpath executeIntent(). */
export function ExecutionLifecycleDiagram() {
  const stages = [
    { label: "construct", sub: "intent" },
    { label: "policy", sub: "allowances" },
    { label: "simulate", sub: "gas + call" },
    { label: "authorize", sub: "human gate" },
    { label: "submit", sub: "one tx" },
    { label: "confirm", sub: "receipt" },
    { label: "log", sub: "record" },
  ];
  return (
    <Frame viewBox="0 0 720 190" caption="fig. 03 — the only path to a write (packages/flightpath/src/execution.ts)">
      {stages.map((stage, index) => {
        const x = 12 + index * 101;
        return (
          <g key={stage.label}>
            <Box x={x} y={66} w={88} h={44} label={stage.label} sub={stage.sub} accent={index === 2 || index === 5} />
            {index < stages.length - 1 && <Arrow from={[x + 90, 88]} to={[x + 99, 88]} />}
          </g>
        );
      })}
      <g stroke={FAINT} strokeWidth="1" strokeDasharray="3 3" fill="none">
        <path d="M 56 66 V 40 H 620 V 66" />
      </g>
      <Label x={338} y={34} color={GREY} size={7.5}>
        every stage can terminate the intent — denied · simulation_failed · reverted · failed
      </Label>
      <Label x={12} y={140} anchor="start" color={INK} size={8}>
        idempotent on execution id — replaying returns the stored record, never a second transaction
      </Label>
      <Label x={12} y={156} anchor="start" color={GREEN} size={8}>
        success renders only from a receipt · an HTTP 200 is not a confirmation
      </Label>
      <Label x={12} y={172} anchor="start" color={GREY} size={8}>
        preview mode never reaches this diagram at all — it has no signer
      </Label>
    </Frame>
  );
}

/** Layered authority: what an agent can actually reach. */
export function PermissionDiagram() {
  return (
    <Frame viewBox="0 0 720 220" caption="fig. 04 — layered authority: an agent never holds unbounded custody">
      <Box x={250} y={14} w={220} h={40} label="human owner" sub="holds the keys, sets the caps" />
      <Arrow from={[360, 56]} to={[360, 80]} label="funds a float" />
      <Box x={230} y={82} w={260} h={44} label="OperatorBudget.sol" sub="per-operator · per-token · per-epoch" accent />
      <Arrow from={[360, 128]} to={[360, 152]} label="bounded spend" />
      <Box x={250} y={154} w={220} h={44} label="restricted operator wallet" sub="what automation actually holds" />

      <g stroke={FAINT} strokeWidth="1" strokeDasharray="2 3" fill="none">
        <path d="M 230 104 H 60 V 176 H 250" />
      </g>
      <Label x={62} y={98} anchor="start" color={GREY} size={7.5}>
        offchain PolicyEngine mirrors the same limits
      </Label>
      <Label x={62} y={132} anchor="start" color={INK} size={8}>
        deny by default
      </Label>
      <Label x={62} y={146} anchor="start" color={GREY} size={7.5}>
        allowlists · per-tx caps · approval threshold
      </Label>

      <Label x={664} y={98} anchor="end" color={GREY} size={7.5}>
        pause · revoke · sweep
      </Label>
      <Label x={664} y={112} anchor="end" color={GREEN} size={7.5}>
        at any time, by the owner
      </Label>
    </Frame>
  );
}

/** Identity and portability. */
export function RegistryDiagram() {
  return (
    <Frame viewBox="0 0 720 200" caption="fig. 05 — identity: the chain is the record, the index is a convenience">
      <Box x={16} y={78} w={110} h={46} label="finch.json" sub="portable manifest" />
      <Arrow from={[130, 90]} to={[196, 66]} label="hash" />
      <Arrow from={[130, 112]} to={[196, 140]} label="publish" />

      <Box x={200} y={44} w={150} h={46} label="FinchRegistry.sol" sub="id · owner · hash · uri" accent />
      <Box x={200} y={118} w={150} h={46} label="content store" sub="manifest body" />

      <Arrow from={[354, 66]} to={[420, 96]} label="events" />
      <Arrow from={[354, 140]} to={[420, 112]} />

      <Box x={424} y={82} w={130} h={44} label="indexer" sub="MongoDB" />
      <Arrow from={[558, 104]} to={[610, 104]} />
      <Box x={614} y={82} w={92} h={44} label="Aviary" sub="discovery" />

      <line x1={16} y1={172} x2={704} y2={172} stroke={FAINT} strokeDasharray="2 4" />
      <Label x={16} y={190} anchor="start" color={INK} size={8}>
        delete the index and the network survives — every record is reconstructable from chain 4663 events
      </Label>
    </Frame>
  );
}
