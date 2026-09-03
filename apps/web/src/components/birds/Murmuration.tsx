"use client";

import { useEffect, useRef } from "react";

/**
 * Murmuration — a boids simulation rendered as a field-study plot: small ink
 * darts on bone, with three "tracked" individuals in Robinhood green wearing
 * study tags. Pauses offscreen; renders a single static frame under
 * prefers-reduced-motion.
 */

interface Bird {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  size: number;
}

const NEIGHBOR_RADIUS = 64;
const SEPARATION_RADIUS = 18;
const MAX_SPEED = 1.7;
const MIN_SPEED = 0.7;

interface Pointer {
  x: number;
  y: number;
  active: boolean;
}

function step(birds: Bird[], width: number, height: number, pointer: Pointer): void {
  for (const bird of birds) {
    let count = 0;
    let avgVx = 0;
    let avgVy = 0;
    let centerX = 0;
    let centerY = 0;
    let sepX = 0;
    let sepY = 0;
    for (const other of birds) {
      if (other === bird) continue;
      const dx = other.x - bird.x;
      const dy = other.y - bird.y;
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
      bird.vx += (avgVx / count - bird.vx) * 0.045;
      bird.vy += (avgVy / count - bird.vy) * 0.045;
      // cohesion
      bird.vx += (centerX / count - bird.x) * 0.0022;
      bird.vy += (centerY / count - bird.y) * 0.0022;
      // separation
      bird.vx += sepX * 0.055;
      bird.vy += sepY * 0.055;
    }
    // The pointer is a soft attractor: the murmuration drifts toward it and orbits,
    // rather than snapping to it. Falls off with distance so distant birds
    // keep their own heading and the formation stays a formation.
    if (pointer.active) {
      const dx = pointer.x - bird.x;
      const dy = pointer.y - bird.y;
      const distance = Math.hypot(dx, dy) || 1;
      const reach = 460;
      if (distance < reach) {
        const pull = (1 - distance / reach) * 0.055;
        bird.vx += (dx / distance) * pull;
        bird.vy += (dy / distance) * pull;
        // A little tangential push turns the gather into an orbit.
        bird.vx += (-dy / distance) * pull * 0.55;
        bird.vy += (dx / distance) * pull * 0.55;
      }
      // Personal space, so they never pile onto the cursor.
      if (distance < 34) {
        bird.vx -= (dx / distance) * 0.09;
        bird.vy -= (dy / distance) * 0.09;
      }
    }

    // gentle pull toward the vertical middle band so the murmuration stays in frame
    bird.vy += (height * 0.5 - bird.y) * 0.0004;
    // small wander
    bird.vx += (Math.random() - 0.5) * 0.04;
    bird.vy += (Math.random() - 0.5) * 0.04;

    const speed = Math.hypot(bird.vx, bird.vy) || 0.001;
    const clamped = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
    bird.vx = (bird.vx / speed) * clamped;
    bird.vy = (bird.vy / speed) * clamped;

    bird.x += bird.vx;
    bird.y += bird.vy;
    if (bird.x < -12) bird.x = width + 12;
    if (bird.x > width + 12) bird.x = -12;
    if (bird.y < -12) bird.y = height + 12;
    if (bird.y > height + 12) bird.y = -12;
  }
}

function draw(ctx: CanvasRenderingContext2D, birds: Bird[], width: number, height: number, tracked: number[]): void {
  ctx.clearRect(0, 0, width, height);
  birds.forEach((bird, index) => {
    const angle = Math.atan2(bird.vy, bird.vx);
    const isTracked = tracked.includes(index);
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(angle);
    ctx.beginPath();
    const s = bird.size;
    ctx.moveTo(s * 1.6, 0);
    ctx.lineTo(-s * 1.2, s);
    ctx.lineTo(-s * 0.5, 0);
    ctx.lineTo(-s * 1.2, -s);
    ctx.closePath();
    if (isTracked) {
      ctx.fillStyle = "#0a7227";
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#191b14";
      ctx.globalAlpha = bird.alpha;
    }
    ctx.fill();
    ctx.restore();

    if (isTracked) {
      ctx.save();
      ctx.strokeStyle = "#0a7227";
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bird.x, bird.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillStyle = "#0a7227";
      ctx.globalAlpha = 0.9;
      ctx.fillText(`F-${String(tracked.indexOf(index) + 1).padStart(2, "0")}`, bird.x + 12, bird.y - 8);
      ctx.restore();
    }
  });
}

export function Murmuration({
  count = 220,
  className = "",
  interactive = true,
}: {
  count?: number;
  className?: string;
  /** Let the murmuration follow the pointer. Disabled automatically for reduced motion. */
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
    let birds: Bird[] = [];
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
      if (birds.length === 0) {
        birds = Array.from({ length: effectiveCount }, () => {
          const angle = Math.random() * Math.PI * 2;
          return {
            x: Math.random() * width,
            y: Math.random() * height,
            vx: Math.cos(angle),
            vy: Math.sin(angle),
            alpha: 0.3 + Math.random() * 0.5,
            size: 2.4 + Math.random() * 1.6,
          };
        });
        tracked = [0, Math.floor(effectiveCount / 2), effectiveCount - 1];
      }
    };

    const tick = () => {
      if (!running) return;
      step(birds, width, height, pointer);
      draw(ctx, birds, width, height, tracked);
      frame = requestAnimationFrame(tick);
    };

    // Pointer tracking lives on the window so the murmuration reacts even when the
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

    // Warm the simulation so even the first frame looks like a murmuration,
    // not a random scatter.
    for (let i = 0; i < 240; i++) step(birds, width, height, pointer);
    draw(ctx, birds, width, height, tracked);

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
