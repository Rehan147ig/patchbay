"use client";

import { useEffect, useRef } from "react";
import { DRAW, STATE_TO_MODE, paintFrame, resolvePreset } from "@/lib/thinking-orbs-engine";

interface ThinkingOrbProps {
  state: "listening" | "composing" | "shaping";
  size?: 20 | 64;
  dark: boolean;
  speedMul?: number;
  active?: boolean;
  className?: string;
  "aria-label": string;
}

/**
 * Canvas orb running the thinking-orbs engine loop. The theme, speed, and
 * active flags are read from refs on every frame so a prop change never
 * leaves a stale paint. The loop is paused while the canvas is off-screen
 * (IntersectionObserver) or the tab is hidden, and fully cancelled when
 * `active` is false — the last painted frame stays on screen.
 */
export function ThinkingOrb({
  state,
  size = 64,
  dark,
  speedMul = 1,
  active = true,
  className,
  "aria-label": ariaLabel,
}: ThinkingOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const darkRef = useRef(dark);
  const speedRef = useRef(speedMul);

  useEffect(() => {
    darkRef.current = dark;
  }, [dark]);
  useEffect(() => {
    speedRef.current = speedMul;
  }, [speedMul]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mode = STATE_TO_MODE[state];
    const { speed, opts } = resolvePreset(mode, size);
    const draw = DRAW[mode];

    let raf: number | null = null;
    let running = false;

    const frame = () => {
      const t = (performance.now() / 1000) * speed * speedRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      paintFrame(ctx, draw(size, t, opts), darkRef.current);
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      running = true;
      frame();
    };

    const stop = () => {
      running = false;
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    };

    let inView = false;
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false;
      if (inView && document.visibilityState === "visible" && active) start();
      else stop();
    });
    observer.observe(canvas);

    const onVisibility = () => {
      if (document.visibilityState === "visible" && inView && active) start();
      else stop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (active) start();

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state, size, active]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={ariaLabel} />;
}
