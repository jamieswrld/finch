"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NestDoc, NestNode } from "@finch/db";
import { DartGlyph } from "@/components/birds/FinchGlyph";
import { Badge } from "@/components/ui/Badge";

/**
 * The nest canvas: stages as columns, finches as node cards, edges drawn as
 * measured bezier connectors in an SVG overlay. Structured on purpose — this
 * is a workflow pipeline, not a free-form node soup.
 */

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  channel: string;
}

function permissionTone(permission: string): "gold" | "sage" | "green" {
  if (permission.startsWith("wallet:") || permission.startsWith("allowance:")) return "gold";
  if (permission.startsWith("veto:")) return "green";
  return "sage";
}

export function NestCanvas({
  nest,
  editable,
  onRemoveFinch,
}: {
  nest: NestDoc;
  editable?: boolean;
  onRemoveFinch?: (stageId: string, handle: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    setSize({ width: containerRect.width, height: containerRect.height });
    const next: Line[] = [];
    for (const edge of nest.edges) {
      const fromEl = nodeRefs.current.get(edge.from);
      const toEl = nodeRefs.current.get(edge.to);
      if (!fromEl || !toEl) continue;
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      next.push({
        x1: fromRect.right - containerRect.left,
        y1: fromRect.top + fromRect.height / 2 - containerRect.top,
        x2: toRect.left - containerRect.left,
        y2: toRect.top + toRect.height / 2 - containerRect.top,
        channel: edge.channel,
      });
    }
    setLines(next);
  }, [nest]);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const registerNode = (handle: string) => (element: HTMLDivElement | null) => {
    if (element) nodeRefs.current.set(handle, element);
    else nodeRefs.current.delete(handle);
  };

  return (
    <div ref={containerRef} className="grid-paper relative overflow-x-auto rounded-xs border border-line bg-bone-raised p-5">
      {/* connectors (desktop horizontal flow) */}
      <svg
        className="pointer-events-none absolute inset-0 hidden lg:block"
        width={size.width}
        height={size.height}
        aria-hidden
      >
        {lines.map((line, index) => {
          const dx = Math.max(32, (line.x2 - line.x1) / 2);
          const path = `M ${line.x1} ${line.y1} C ${line.x1 + dx} ${line.y1}, ${line.x2 - dx} ${line.y2}, ${line.x2} ${line.y2}`;
          const midX = (line.x1 + line.x2) / 2;
          const midY = (line.y1 + line.y2) / 2;
          return (
            <g key={index}>
              <path d={path} fill="none" stroke="#67765e" strokeWidth="1.25" />
              <path d={`M ${line.x2} ${line.y2} l -6 -3.5 v 7 Z`} fill="#67765e" />
              <rect x={midX - 34} y={midY - 17} width="68" height="13" rx="2" fill="#faf9f4" opacity="0.9" />
              <text
                x={midX}
                y={midY - 7}
                textAnchor="middle"
                fontFamily="var(--font-geist-mono), monospace"
                fontSize="8.5"
                fill="#67765e"
              >
                {line.channel}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="relative flex min-w-[760px] flex-col gap-6 lg:min-w-0 lg:flex-row lg:items-start lg:gap-10">
        {nest.stages.map((stage, stageIndex) => (
          <div key={stage.id} className="flex-1">
            <p className="label-mono flex items-baseline gap-2">
              <span className="text-green-deep tnum">{String(stageIndex + 1).padStart(2, "0")}</span>
              {stage.name}
            </p>
            <div className="mt-3 flex flex-col gap-4">
              {stage.finches.map((finch) => (
                <FinchNode
                  key={finch.handle}
                  finch={finch}
                  refCallback={registerNode(finch.handle)}
                  editable={editable}
                  onRemove={onRemoveFinch ? () => onRemoveFinch(stage.id, finch.handle) : undefined}
                />
              ))}
              {stage.finches.length === 0 && (
                <p className="rounded-xs border border-dashed border-line-strong p-4 text-center font-mono text-[10.5px] text-grey-faint">
                  empty stage
                </p>
              )}
            </div>
            {/* mobile flow arrow */}
            {stageIndex < nest.stages.length - 1 && (
              <p className="mt-4 text-center font-mono text-[12px] text-sage-deep lg:hidden">↓</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FinchNode({
  finch,
  refCallback,
  editable,
  onRemove,
}: {
  finch: NestNode;
  refCallback: (element: HTMLDivElement | null) => void;
  editable?: boolean;
  onRemove?: () => void;
}) {
  return (
    <div ref={refCallback} className="relative rounded-xs border border-line bg-bone p-3.5 shadow-[0_1px_0_0_rgba(25,27,20,0.05)]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <DartGlyph size={13} angle={-16} className="text-ink" />
          <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{finch.name}</p>
        </div>
        {editable && onRemove && (
          <button type="button" aria-label={`Remove ${finch.name}`} onClick={onRemove} className="font-mono text-[12px] text-grey hover:text-red-deep">
            ×
          </button>
        )}
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-grey">{finch.role}</p>
      <dl className="mt-2.5 space-y-1 font-mono text-[10px]">
        <div className="flex gap-1.5">
          <dt className="text-grey-faint shrink-0">in</dt>
          <dd className="text-ink-soft break-words min-w-0">{finch.inputs.length > 0 ? finch.inputs.join(", ") : "—"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-grey-faint shrink-0">out</dt>
          <dd className="text-ink-soft break-words min-w-0">{finch.outputs.length > 0 ? finch.outputs.join(", ") : "—"}</dd>
        </div>
      </dl>
      {finch.permissions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {finch.permissions.map((permission) => (
            <Badge key={permission} tone={permissionTone(permission)}>
              {permission}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
