"use client";

import { useEffect, useRef } from "react";

/**
 * SwarmField — a boids-style swarm simulation rendered as a plot: small ink dots on
 * bone, with three "tracked" agents in the green accent, each tagged and
 * linked to the neighbours it is reading. Pauses offscreen; renders a single
 * static frame under prefers-reduced-motion.
 */

interface Agent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Index into ALPHA_BUCKETS — dots are drawn in three batched passes. */
  tone: number;
  r: number;
}

const NEIGHBOR_RADIUS = 64;
const SEPARATION_RADIUS = 18;
const LINK_RADIUS = 52;
const MAX_SPEED = 1.7;
const MIN_SPEED = 0.7;
const ALPHA_BUCKETS = [0.32, 0.5, 0.72];
const INK = "#191b14";
const GREEN = "#0a7227";

interface Pointer {
  x: number;
  y: number;
  active: boolean;
}

function step(agents: Agent[], width: number, height: number, pointer: Pointer): void {
  for (const agent of agents) {
    let count = 0;
    let avgVx = 0;
    let avgVy = 0;
    let centerX = 0;
    let centerY = 0;
    let sepX = 0;
    let sepY = 0;
    for (const other of agents) {
      if (other === agent) continue;
      const dx = other.x - agent.x;
      const dy = other.y - agent.y;
      const dist = Math.hypot(dx, dy);
      if (dist < NEIGHBOR_RADIUS) {
        count++;
        avgVx += other.vx;
        avgVy += other.vy;
        centerX += other.x;
        centerY += other.y;
        if (dist < SEPARATION_RADIUS && dist > 0) {
          sepX -= dx / dist;
          sepY -= dy / dist;
        }
      }
    }
    if (count > 0) {
      // alignment
      agent.vx += (avgVx / count - agent.vx) * 0.045;
      agent.vy += (avgVy / count - agent.vy) * 0.045;
      // cohesion
      agent.vx += (centerX / count - agent.x) * 0.0022;
      agent.vy += (centerY / count - agent.y) * 0.0022;
      // separation
      agent.vx += sepX * 0.055;
      agent.vy += sepY * 0.055;
    }
    // The pointer is a soft attractor: the swarm drifts toward it and orbits,
    // rather than snapping to it. Falls off with distance so distant agents
    // keep their own heading and the formation stays a formation.
    if (pointer.active) {
      const dx = pointer.x - agent.x;
      const dy = pointer.y - agent.y;
      const distance = Math.hypot(dx, dy) || 1;
      const reach = 460;
      if (distance < reach) {
        const pull = (1 - distance / reach) * 0.055;
        agent.vx += (dx / distance) * pull;
        agent.vy += (dy / distance) * pull;
        // A little tangential push turns the gather into an orbit.
        agent.vx += (-dy / distance) * pull * 0.55;
        agent.vy += (dx / distance) * pull * 0.55;
      }
      // Personal space, so they never pile onto the cursor.
      if (distance < 34) {
        agent.vx -= (dx / distance) * 0.09;
        agent.vy -= (dy / distance) * 0.09;
      }
    }

    // gentle pull toward the vertical middle band so the swarm stays in frame
    agent.vy += (height * 0.5 - agent.y) * 0.0004;
    // small wander
    agent.vx += (Math.random() - 0.5) * 0.04;
    agent.vy += (Math.random() - 0.5) * 0.04;

    const speed = Math.hypot(agent.vx, agent.vy) || 0.001;
    const clamped = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
    agent.vx = (agent.vx / speed) * clamped;
    agent.vy = (agent.vy / speed) * clamped;

    agent.x += agent.vx;
    agent.y += agent.vy;
    if (agent.x < -12) agent.x = width + 12;
    if (agent.x > width + 12) agent.x = -12;
    if (agent.y < -12) agent.y = height + 12;
    if (agent.y > height + 12) agent.y = -12;
  }
}

function draw(ctx: CanvasRenderingContext2D, agents: Agent[], width: number, height: number, tracked: number[]): void {
  ctx.clearRect(0, 0, width, height);

  // Links first, so the dots sit on top: each tracked agent to the neighbours
  // it is currently reading. Linear in the swarm size — three scans, not n².
  ctx.save();
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 0.75;
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  for (const index of tracked) {
    const agent = agents[index];
    if (!agent) continue;
    for (const other of agents) {
      if (other === agent) continue;
      const dx = other.x - agent.x;
      const dy = other.y - agent.y;
      if (dx * dx + dy * dy < LINK_RADIUS * LINK_RADIUS) {
        ctx.moveTo(agent.x, agent.y);
        ctx.lineTo(other.x, other.y);
      }
    }
  }
  ctx.stroke();
  ctx.restore();

  // Untracked dots, batched into one path per alpha bucket.
  ctx.save();
  ctx.fillStyle = INK;
  ALPHA_BUCKETS.forEach((alpha, tone) => {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    agents.forEach((agent, index) => {
      if (agent.tone !== tone || tracked.includes(index)) return;
      ctx.moveTo(agent.x + agent.r, agent.y);
      ctx.arc(agent.x, agent.y, agent.r, 0, Math.PI * 2);
    });
    ctx.fill();
  });
  ctx.restore();

  tracked.forEach((index, order) => {
    const agent = agents[index];
    if (!agent) return;
    ctx.save();
    ctx.fillStyle = GREEN;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(agent.x, agent.y, agent.r + 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = GREEN;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(agent.x, agent.y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "9px ui-monospace, monospace";
    ctx.globalAlpha = 0.9;
    ctx.fillText(`a-${String(order + 1).padStart(2, "0")}`, agent.x + 12, agent.y - 8);
    ctx.restore();
  });
}

export function SwarmField({
  count = 220,
  className = "",
  interactive = true,
}: {
  count?: number;
  className?: string;
  /** Let the swarm follow the pointer. Disabled automatically for reduced motion. */
  interactive?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const effectiveCount = window.innerWidth < 640 ? Math.min(count, 110) : count;

    let width = 0;
    let height = 0;
    let agents: Agent[] = [];
    let tracked: number[] = [];
    let frame = 0;
    let running = false;
    const pointer: Pointer = { x: 0, y: 0, active: false };

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (agents.length === 0) {
        agents = Array.from({ length: effectiveCount }, () => {
          const angle = Math.random() * Math.PI * 2;
          return {
            x: Math.random() * width,
            y: Math.random() * height,
            vx: Math.cos(angle),
            vy: Math.sin(angle),
            tone: Math.floor(Math.random() * ALPHA_BUCKETS.length),
            r: 1.3 + Math.random() * 1.1,
          };
        });
        tracked = [0, Math.floor(effectiveCount / 2), effectiveCount - 1];
      }
    };

    const tick = () => {
      if (!running) return;
      step(agents, width, height, pointer);
      draw(ctx, agents, width, height, tracked);
      frame = requestAnimationFrame(tick);
    };

    // Pointer tracking lives on the window so the swarm reacts even when the
    // cursor is over text layered above the canvas.
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const margin = 140;
      pointer.x = x;
      pointer.y = y;
      pointer.active =
        x > -margin && x < rect.width + margin && y > -margin && y < rect.height + margin;
    };
    const onPointerLeave = () => {
      pointer.active = false;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // Warm the simulation so even the first frame looks like a swarm,
    // not a random scatter.
    for (let i = 0; i < 240; i++) step(agents, width, height, pointer);
    draw(ctx, agents, width, height, tracked);

    if (interactive && !reducedMotion) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerleave", onPointerLeave, { passive: true });
    }

    if (reducedMotion) {
      // Single organic still frame only.
    } else {
      const visibility = new IntersectionObserver(
        (entries) => {
          const visible = entries[0]?.isIntersecting ?? false;
          if (visible && !running) {
            running = true;
            frame = requestAnimationFrame(tick);
          } else if (!visible && running) {
            running = false;
            cancelAnimationFrame(frame);
          }
        },
        { threshold: 0.05 },
      );
      visibility.observe(canvas);
      return () => {
        running = false;
        cancelAnimationFrame(frame);
        visibility.disconnect();
        observer.disconnect();
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerleave", onPointerLeave);
      };
    }
    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [count, interactive]);

  return <canvas ref={canvasRef} className={`block h-full w-full ${className}`} aria-hidden />;
}
