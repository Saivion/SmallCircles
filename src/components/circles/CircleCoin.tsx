"use client";

import { memo, useMemo } from "react";
import { ringPath, ringShapePath } from "@/lib/doodle/compose";
import { hash } from "@/lib/doodle/pen";
import { Doodle } from "./Doodle";

type Props = {
  id: string;
  seed: number;
  photoUrl: string | null;
  illustrations: string[];
  drawing?: boolean;
};

/**
 * A circle, small: the photo cut to its ring's wobble, the ring, and a few of its
 * doodles sitting on the ring. Used where circles are browsed, not read.
 */
export const CircleCoin = memo(function CircleCoin({ id, seed, photoUrl, illustrations, drawing }: Props) {
  const ring = useMemo(() => ({ cx: 100, cy: 100, rx: 74, ry: 74, seed: hash(`${seed}:coin`) }), [seed]);
  const d0 = useMemo(() => ringPath(ring, 0), [ring]);
  const d1 = useMemo(() => ringPath(ring, 1), [ring]);
  // The photo takes its ring's wobble, a little smaller, so no two are perfectly round and each echoes its ring.
  // (A touch softer than the ring itself, so the photo always sits clear of the line drawn round it.)
  const cut = useMemo(() => ringShapePath(ring, 56, 56, 0.72), [ring]);
  const backing = useMemo(() => ringShapePath(ring, 58.5, 58.5, 0.72), [ring]);
  const clip = `coin-${id}`;
  // Up to four doodles on the ring, spread evenly from a seeded start.
  const start = (seed % 360) * (Math.PI / 180);
  const shown = illustrations.slice(0, 4);
  return (
    <svg viewBox="0 0 200 200" className={`coin${drawing ? " is-drawing" : ""}`} aria-hidden>
      <defs>
        <clipPath id={clip}>
          <path d={cut} />
        </clipPath>
      </defs>
      <path d={backing} fill="var(--sheet)" />
      {photoUrl ? (
        // A little larger than the cut, so the wobble's widest points are still photo.
        <image href={photoUrl} x={34} y={34} width={132} height={132} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} />
      ) : null}
      <path d={d0} fill="none" stroke="var(--ink)" strokeWidth={1.6} strokeLinecap="round" />
      <path d={d1} fill="none" stroke="var(--ink)" strokeWidth={0.8} strokeLinecap="round" opacity={0.4} />
      {shown.map((ill, i) => {
        const a = start + (i / Math.max(shown.length, 3)) * Math.PI * 2;
        return (
          <g key={`${ill}${i}`} className="coin-doodle">
            <circle cx={100 + Math.cos(a) * 76} cy={100 + Math.sin(a) * 76} r={17} fill="var(--paper)" />
            <Doodle id={ill} seed={hash(`${seed}:${i}`)} x={100 + Math.cos(a) * 76} y={100 + Math.sin(a) * 76} size={30} rotate={((seed >> i) % 20) - 10} penWidth={1.5} />
          </g>
        );
      })}
    </svg>
  );
});
