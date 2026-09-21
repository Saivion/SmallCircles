"use client";

import { memo, useEffect, useRef } from "react";

/** 4x4 Bayer matrix, normalised to 0..1 thresholds. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((n) => (n + 0.5) / 16);

/** Black through greys, left to right with a drift. */
const STOPS: [number, number, number][] = [
  [0, 0, 0],
  [90, 90, 90],
  [175, 175, 175],
  [0, 0, 0],
];

function mix(t: number): [number, number, number] {
  const x = ((t % 1) + 1) % 1;
  const f = x * (STOPS.length - 1);
  const i = Math.floor(f);
  const k = f - i;
  const a = STOPS[i];
  const b = STOPS[Math.min(i + 1, STOPS.length - 1)];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/**
 * An ordered-dither glow along the bottom of the page: a slow, soft field of
 * dots that thickens towards the bottom edge.
 */
export const Dither = memo(function Dither({ cell = 3 }: { cell?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;
    let cols = 0;
    let rows = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / cell);
      rows = Math.ceil(height / cell);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, cols * cell, rows * cell);
      const dot = cell * 0.55;
      for (let y = 0; y < rows; y++) {
        const v = y / rows;
        for (let x = 0; x < cols; x++) {
          const u = x / cols;
          // A rolling horizon: low waves lift and settle the glow over time.
          const wave = 0.16 * Math.sin(u * 5.2 + t * 0.35) + 0.1 * Math.sin(u * 11.7 - t * 0.22) + 0.07 * Math.sin((u + v) * 17 + t * 0.5);
          const level = Math.min(1, Math.max(0, (v - 0.32 + wave) * 1.4));
          if (level <= BAYER[(y & 3) * 4 + (x & 3)]) continue;
          const [r, g, b] = mix(u * 0.9 + 0.08 * Math.sin(v * 3 + t * 0.15) + t * 0.01);
          ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.12 + level * 0.46})`;
          ctx.fillRect(x * cell, y * cell, dot, dot);
        }
      }
    };

    const tick = (now: number) => {
      // About 15 frames a second is plenty for a drift this slow.
      if (now - last > 66) {
        last = now;
        draw(now / 1000);
      }
      raf = requestAnimationFrame(tick);
    };

    resize();
    draw(0);
    if (!still) raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => {
      resize();
      draw(last / 1000);
    });
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [cell]);

  return <canvas ref={ref} className="dither" aria-hidden="true" />;
});
