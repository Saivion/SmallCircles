/**
 * The illustration vocabulary, drawn. One primitive per id in
 * convex/lib/vocabulary.ts. Each draws into a 100×100 box with the pen:
 * marker fills first (they sit under the ink), then a few confident strokes.
 *
 * House style (see DESIGN.md §6): 1–6 strokes, simple silhouettes, the
 * marker covering one shape only, no shading, no hatching unless it is the
 * point of the thing (rain, waves). Draw what a quick hand would draw.
 *
 * Box conventions: content sits roughly within 8..92, visually centred;
 * things that stand on the ground sit on y ≈ 90.
 */
import type { DoodleId } from "@convex/lib/vocabulary";
import type { Pen, Primitive, Pt } from "./pen";

// ---------------------------------------------------------------------------
// Geometry helpers (pure; they only build point lists for the pen)
// ---------------------------------------------------------------------------

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Points along an elliptical arc (degrees, 0 = right, clockwise, y down). */
function arc(cx: number, cy: number, rx: number, ry: number, from: number, sweep: number, n = 12): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = rad(from + (sweep * i) / n);
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

/** Rotate points about a centre. */
function rot(pts: Pt[], deg: number, cx = 50, cy = 50): Pt[] {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c] as Pt);
}

/** A rectangle with rounded corners, as a closed point list. */
function roundRect(x: number, y: number, w: number, h: number, r: number): Pt[] {
  return [
    ...arc(x + w - r, y + r, r, r, -90, 90, 4),
    ...arc(x + w - r, y + h - r, r, r, 0, 90, 4),
    ...arc(x + r, y + h - r, r, r, 90, 90, 4),
    ...arc(x + r, y + r, r, r, 180, 90, 4),
  ];
}

/**
 * The outline of a union of circles (a cloud, a canopy, a scoop), traced by
 * casting rays from a centre. Anything below `floor` is cut flat.
 */
function blob(circles: [number, number, number][], cx: number, cy: number, floor = Infinity, step = 6): Pt[] {
  const inside = (x: number, y: number) => y <= floor && circles.some(([a, b, r]) => (x - a) ** 2 + (y - b) ** 2 <= r * r);
  const pts: Pt[] = [];
  for (let deg = 0; deg < 360; deg += step) {
    const dx = Math.cos(rad(deg));
    const dy = Math.sin(rad(deg));
    let d = 70;
    while (d > 0 && !inside(cx + dx * d, cy + dy * d)) d -= 0.25;
    pts.push([cx + dx * d, cy + dy * d]);
  }
  return pts;
}

/** A leaf/frond/petal: a closed outline around a quadratic midrib. */
function leafShape(a: Pt, c: Pt, b: Pt, w: number, n = 10): Pt[] {
  const q = (t: number): Pt => [
    (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
    (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
  ];
  const side = (sign: number) => {
    const out: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p0 = q(Math.max(0, t - 0.01));
      const p1 = q(Math.min(1, t + 0.01));
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const l = Math.hypot(dx, dy) || 1;
      const off = sign * w * Math.sin(Math.PI * t) ** 0.8;
      const m = q(t);
      out.push([m[0] - (dy / l) * off, m[1] + (dx / l) * off]);
    }
    return out;
  };
  return [...side(1), ...side(-1).reverse().slice(1, -1)];
}

/** Midrib of a leafShape, for the vein. */
function rib(a: Pt, c: Pt, b: Pt, n = 8): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([
      (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
      (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
    ]);
  }
  return pts;
}

/** A five-pointed star. */
function starPts(cx: number, cy: number, R: number, r: number, turn = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const a = rad(-90 + turn + i * 36);
    const d = i % 2 === 0 ? R : r;
    pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Place
// ---------------------------------------------------------------------------

const pin: Primitive = (p) => {
  p.fillEllipse(50, 36, 18, 18, "coral");
  p.curve([[50, 90], [36, 64], [30, 44], [34, 26], [50, 14], [66, 26], [70, 44], [64, 64], [50, 90]]);
  p.circle(50, 38, 7);
};

const map: Primitive = (p) => {
  const outline: Pt[] = [[12, 26], [37, 18], [63, 26], [88, 18], [88, 76], [63, 84], [37, 76], [12, 84]];
  p.fill(outline, "sky");
  p.poly(outline, true);
  // folds
  p.line(37, 18, 37, 76);
  p.line(63, 26, 63, 84);
  // dotted route to an X
  const route: Pt[] = [[20, 72], [26, 60], [36, 56], [46, 62], [56, 52], [62, 42]];
  for (let i = 0; i < route.length - 1; i += 1) {
    const [a, b] = [route[i], route[i + 1]];
    p.line(a[0], a[1], a[0] + (b[0] - a[0]) * 0.55, a[1] + (b[1] - a[1]) * 0.55);
  }
  p.line(66, 32, 76, 42).line(76, 32, 66, 42);
};

const tower: Primitive = (p) => {
  p.fill([[41, 62], [59, 62], [70, 90], [30, 90]], "sun");
  // legs, curving in toward the top
  p.curve([[27, 91], [38, 62], [46, 36], [49, 14]]);
  p.curve([[73, 91], [62, 62], [54, 36], [51, 14]]);
  // platforms
  p.line(34, 64, 66, 64);
  p.line(42, 40, 58, 40);
  // arch under the first platform
  p.ellipse(50, 91, 13, 15, 180, 180);
  // lattice
  p.line(39, 63, 55, 41);
  p.line(61, 63, 45, 41);
  // spire
  p.line(50, 14, 50, 7);
};

const dome: Primitive = (p) => {
  const domePts = [...arc(50, 50, 21, 24, 180, 180, 14)];
  p.fill([...domePts], "sun");
  // dome and drum
  p.poly(domePts);
  p.rect(27, 50, 46, 8);
  // lantern + spire
  p.rect(46, 20, 8, 6);
  p.line(50, 20, 50, 10);
  // hall with columns
  p.poly([[18, 90], [18, 58], [82, 58], [82, 90]]);
  p.line(30, 64, 30, 88).line(42, 64, 42, 88).line(58, 64, 58, 88).line(70, 64, 70, 88);
  p.line(12, 90, 88, 90);
};

const arch: Primitive = (p) => {
  const opening = arc(50, 60, 11, 12, 0, -180, 10); // right → over the top → left
  const facade: Pt[] = [[20, 32], [80, 32], [80, 90], [61, 90], ...opening, [39, 90], [20, 90]];
  p.fill(facade, "sun");
  // cornice and attic
  p.poly([[16, 20], [84, 20], [84, 32], [16, 32]], true);
  // piers + opening, one continuous stroke
  p.poly([[20, 32], [20, 90], [39, 90], [39, 60], ...opening.slice(1, -1).reverse(), [61, 60], [61, 90], [80, 90], [80, 32]]);
  // impost line
  p.line(20, 58, 38, 58).line(62, 58, 80, 58);
  p.line(10, 91, 90, 91);
};

const bridge: Primitive = (p) => {
  p.fill([[10, 70], [90, 70], [90, 84], [10, 84]], "sky");
  // towers: two legs and a crossbar each
  p.line(28, 22, 28, 74).line(32, 22, 32, 74).line(28, 34, 32, 34);
  p.line(68, 22, 68, 74).line(72, 22, 72, 74).line(68, 34, 72, 34);
  // deck
  p.line(8, 58, 92, 58);
  // main cable, sagging between towers
  p.curve([[8, 54], [22, 40], [30, 22]]);
  p.curve([[30, 22], [42, 44], [50, 50], [58, 44], [70, 22]]);
  p.curve([[70, 22], [78, 40], [92, 54]]);
  // hangers
  p.line(40, 38, 40, 58).line(50, 50, 50, 58).line(60, 38, 60, 58);
  // water
  p.curve([[12, 78], [22, 75], [32, 78], [42, 75], [52, 78], [62, 75], [72, 78], [82, 75], [90, 78]]);
};

const building: Primitive = (p) => {
  p.fillRect(28, 22, 44, 68, "sun");
  p.poly([[28, 90], [28, 22], [72, 22], [72, 90]]);
  p.line(24, 22, 76, 22);
  // flag
  p.line(50, 22, 50, 8);
  p.poly([[50, 9], [60, 12], [50, 15]]);
  // windows
  for (const y of [30, 44, 58]) {
    p.rect(35, y, 9, 8);
    p.rect(56, y, 9, 8);
  }
  // door
  p.poly([[44, 90], [44, 74], [56, 74], [56, 90]]);
  p.line(16, 90, 84, 90);
};

const house: Primitive = (p) => {
  p.fill([[18, 52], [50, 22], [82, 52]], "coral");
  // roof
  p.poly([[16, 54], [50, 22], [84, 54]]);
  // chimney
  p.poly([[64, 36], [64, 24], [72, 24], [72, 43]]);
  // walls
  p.poly([[24, 48], [24, 90], [76, 90], [76, 48]]);
  // door + window
  p.poly([[42, 90], [42, 68], [54, 68], [54, 90]]);
  p.rect(60, 60, 10, 10);
  p.dot(51, 80, 1.2);
};

const skyline: Primitive = (p) => {
  const sil: Pt[] = [
    [10, 88], [10, 50], [24, 50], [24, 30], [36, 30], [36, 20], [44, 20], [44, 40], [56, 40],
    [56, 22], [62, 12], [68, 22], [68, 56], [78, 56], [78, 38], [90, 38], [90, 88],
  ];
  p.fill(sil, "sky");
  p.poly(sil);
  p.line(6, 88, 94, 88);
  // a few windows
  p.line(28, 40, 32, 40).line(28, 50, 32, 50).line(28, 60, 32, 60);
  p.line(60, 34, 64, 34).line(60, 46, 64, 46);
  p.line(82, 48, 86, 48).line(82, 60, 86, 60);
};

const mountain: Primitive = (p) => {
  const ridge: Pt[] = [[8, 86], [38, 22], [56, 56], [70, 40], [92, 86]];
  p.fill(ridge, "leaf");
  p.poly(ridge);
  p.line(6, 86, 94, 86);
  // snow cap
  p.poly([[31, 37], [36, 43], [40, 37], [44, 44], [46.5, 39]]);
};

const ferris_wheel: Primitive = (p) => {
  const cx = 50;
  const cy = 42;
  const R = 29;
  const turn = p.between(0, 20);
  const angles = [0, 60, 120, 180, 240, 300].map((a) => a + turn);
  // cabins get the marker
  for (const a of angles) {
    const x = cx + Math.cos(rad(a)) * R;
    const y = cy + Math.sin(rad(a)) * R;
    p.fill(roundRect(x - 4.5, y + 1, 9, 7, 2), "coral");
  }
  // stand
  p.line(50, 42, 32, 90);
  p.line(50, 42, 68, 90);
  p.line(24, 90, 76, 90);
  // wheel + spokes
  p.circle(cx, cy, R);
  for (let i = 0; i < 3; i++) {
    const a = rad(angles[i]);
    p.line(cx + Math.cos(a) * R, cy + Math.sin(a) * R, cx - Math.cos(a) * R, cy - Math.sin(a) * R);
  }
  p.circle(cx, cy, 3);
  // cabins
  for (const a of angles) {
    const x = cx + Math.cos(rad(a)) * R;
    const y = cy + Math.sin(rad(a)) * R;
    p.poly(roundRect(x - 4.5, y + 1, 9, 7, 2), true);
  }
};

const tent: Primitive = (p) => {
  const body: Pt[] = [[12, 88], [50, 24], [88, 88]];
  p.fill(body, "leaf");
  p.poly(body);
  // door flap
  p.poly([[38, 88], [50, 56], [62, 88]]);
  // pole tip + pennant
  p.line(50, 24, 50, 12);
  p.poly([[50, 12], [60, 15], [50, 18]]);
  // guy line and ground
  p.line(24, 68, 10, 80);
  p.line(6, 88, 94, 88);
};

// ---------------------------------------------------------------------------
// Nature
// ---------------------------------------------------------------------------

const sun: Primitive = (p) => {
  p.fillEllipse(50, 50, 20, 20, "sun");
  p.circle(50, 50, 18);
  const rays = 9;
  const turn = p.between(0, 40);
  for (let i = 0; i < rays; i++) {
    const a = rad(turn + (i * 360) / rays);
    const r1 = 26 + p.between(-1, 2);
    const r2 = 36 + p.between(-2, 3);
    p.line(50 + Math.cos(a) * r1, 50 + Math.sin(a) * r1, 50 + Math.cos(a) * r2, 50 + Math.sin(a) * r2);
  }
};

const sunset: Primitive = (p) => {
  const hy = 64;
  const half = arc(50, hy, 22, 22, 180, 180, 12);
  p.fill(half, "coral");
  p.poly(half);
  p.line(8, hy, 92, hy);
  for (const deg of [-162, -126, -90, -54, -18]) {
    const a = rad(deg);
    p.line(50 + Math.cos(a) * 28, hy + Math.sin(a) * 28, 50 + Math.cos(a) * 38, hy + Math.sin(a) * 38);
  }
  // reflection on the water
  p.line(34, 73, 66, 73);
  p.line(42, 81, 58, 81);
};

const moon: Primitive = (p) => {
  const outer = arc(44, 52, 30, 30, 60, 240, 20); // bottom-right, round the left, to top-right
  const inner: Pt[] = [[59, 26], [46, 36], [40, 52], [46, 68], [59, 78]];
  p.fill([...outer, ...inner.slice(1, -1).reverse()], "sky");
  p.poly(outer);
  p.curve(inner);
  // a small star
  p.poly(starPts(77, 30, 8, 3.4, p.between(-8, 8)), true);
};

const cloudCircles: [number, number, number][] = [
  [30, 60, 13],
  [48, 48, 18],
  [67, 53, 14],
  [80, 63, 9],
];

const cloud: Primitive = (p) => {
  const outline = blob(cloudCircles, 52, 60, 70);
  p.fill(outline, "sky");
  p.poly(outline, true);
};

const rain: Primitive = (p) => {
  const small = cloudCircles.map(([x, y, r]) => [x, y - 24, r] as [number, number, number]);
  const outline = blob(small, 52, 36, 46);
  p.fill(outline, "sky");
  p.poly(outline, true);
  for (const [x, y] of [[28, 56], [44, 58], [60, 56], [76, 58], [36, 74], [52, 76], [68, 74]] as Pt[]) {
    p.line(x, y, x - 4, y + 10);
  }
};

const snow: Primitive = (p) => {
  p.fillEllipse(50, 50, 18, 18, "sky");
  const turn = p.between(-6, 6);
  for (let i = 0; i < 6; i++) {
    const a = rad(turn + 90 + i * 60);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    if (i < 3) p.line(50 + ux * 36, 50 + uy * 36, 50 - ux * 36, 50 - uy * 36);
    // a V near the tip of each arm
    const bx = 50 + ux * 24;
    const by = 50 + uy * 24;
    const l = rad(turn + 90 + i * 60 + 40);
    const r = rad(turn + 90 + i * 60 - 40);
    p.poly([
      [bx + Math.cos(l) * 9, by + Math.sin(l) * 9],
      [bx, by],
      [bx + Math.cos(r) * 9, by + Math.sin(r) * 9],
    ]);
  }
};

const wave: Primitive = (p) => {
  const crest: Pt[] = [[8, 70], [26, 62], [40, 46], [54, 32], [70, 28], [82, 34], [86, 44], [80, 52], [70, 50], [68, 42]];
  p.fill([[8, 70], [26, 62], [40, 46], [54, 32], [70, 28], [82, 34], [86, 44], [90, 70]], "sky");
  p.curve(crest);
  p.curve([[8, 70], [30, 70], [50, 72], [70, 68], [92, 70]]);
  p.curve([[12, 80], [22, 76], [32, 80], [42, 76], [52, 80], [62, 76], [72, 80], [82, 76], [90, 80]]);
  p.curve([[22, 89], [32, 85], [42, 89], [52, 85], [62, 89], [72, 85], [80, 89]]);
};

const palm: Primitive = (p) => {
  const top: Pt = [52, 30];
  const fronds: [Pt, Pt][] = [
    [[30, 18], [12, 40]],
    [[40, 14], [26, 20]],
    [[62, 12], [78, 18]],
    [[72, 18], [90, 40]],
    [[54, 22], [60, 52]],
  ];
  for (const [c, b] of fronds) p.fill(leafShape(top, c, b, 5, 8), "leaf");
  // trunk
  p.curve([[44, 90], [46, 66], [50, 46], [52, 30]]);
  p.curve([[54, 90], [55, 66], [56, 46], [55, 32]]);
  // fronds
  for (const [c, b] of fronds) p.poly(leafShape(top, c, b, 5, 8), true);
  // coconuts + ground
  p.dot(49, 34, 2.4).dot(56, 35, 2.4);
  p.curve([[22, 91], [50, 87], [78, 91]]);
};

const tree: Primitive = (p) => {
  const canopy = blob(
    [
      [36, 44, 16],
      [52, 32, 18],
      [66, 46, 16],
      [50, 54, 16],
    ],
    51,
    44,
  );
  p.fill(canopy, "leaf");
  p.poly(canopy, true);
  p.line(46, 90, 47, 64);
  p.line(55, 90, 54, 64);
  p.line(50, 72, 42, 62);
  p.line(34, 90, 68, 90);
};

const flower: Primitive = (p) => {
  const cx = 50;
  const cy = 36;
  const turn = p.between(-10, 10);
  const petals: [number, number, number][] = [0, 1, 2, 3, 4].map((i) => {
    const a = rad(-90 + turn + i * 72);
    return [cx + Math.cos(a) * 13, cy + Math.sin(a) * 13, 10];
  });
  const head = blob(petals, cx, cy, Infinity, 5);
  p.fill(head, "coral");
  p.poly(head, true);
  p.circle(cx, cy, 6);
  // stem + leaf
  p.curve([[50, 58], [48, 74], [50, 90]]);
  p.poly(leafShape([49, 76], [58, 64], [70, 66], 5, 8), true);
};

const leaf: Primitive = (p) => {
  const a: Pt = [28, 76];
  const c: Pt = [30, 30];
  const b: Pt = [78, 16];
  const shape = leafShape(a, c, b, 17, 12);
  p.fill(shape, "leaf");
  p.poly(shape, true);
  const mid = rib(a, c, b, 10);
  p.curve([[18, 88], ...mid.slice(0, 9)]);
  // veins, angled toward the tip
  for (const i of [3, 5]) {
    const [x, y] = mid[i];
    const [nx, ny] = mid[i + 2];
    const dx = (nx - x) / 2;
    const dy = (ny - y) / 2;
    p.line(x, y, x + dx - dy * 1.1, y + dy + dx * 1.1);
    p.line(x, y, x + dx + dy * 1.1, y + dy - dx * 1.1);
  }
};

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const clock: Primitive = (p) => {
  p.circle(50, 50, 36);
  for (let i = 0; i < 4; i++) {
    const a = rad(i * 90);
    p.line(50 + Math.cos(a) * 29, 50 + Math.sin(a) * 29, 50 + Math.cos(a) * 34, 50 + Math.sin(a) * 34);
  }
  const hour = rad(p.between(-150, -120));
  const minute = rad(p.between(-100, -70));
  p.line(50, 50, 50 + Math.cos(hour) * 16, 50 + Math.sin(hour) * 16);
  p.line(50, 50, 50 + Math.cos(minute) * 25, 50 + Math.sin(minute) * 25);
  p.dot(50, 50, 2.4);
};

const calendar: Primitive = (p) => {
  p.fill([[18, 24], [82, 24], [82, 40], [18, 40]], "coral");
  p.poly(roundRect(18, 24, 64, 64, 4), true);
  p.line(18, 40, 82, 40);
  // rings
  p.line(34, 16, 34, 30);
  p.line(66, 16, 66, 30);
  // days
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) p.dot(30 + c * 13.3, 52 + r * 12, 1.5);
  // one circled
  p.ellipse(56.6, 64, 7, 6);
};

const star: Primitive = (p) => {
  const pts = starPts(50, 53, 38, 16, p.between(-6, 6));
  p.fill(pts, "sun");
  p.poly(pts, true);
};

// ---------------------------------------------------------------------------
// Food and drink
// ---------------------------------------------------------------------------

const coffee: Primitive = (p) => {
  p.fill([[26, 44], [66, 44], [62, 80], [30, 80]], "coral");
  // cup
  p.poly([[24, 42], [68, 42], [63, 82], [29, 82]], true);
  // handle
  p.curve([[67, 52], [80, 52], [80, 68], [65, 70]]);
  // saucer
  p.curve([[14, 84], [30, 90], [62, 90], [78, 84]]);
  // steam
  p.curve([[38, 34], [34, 26], [40, 18], [36, 10]]);
  p.curve([[52, 34], [48, 26], [54, 18], [50, 10]]);
};

const wine: Primitive = (p) => {
  p.fill([[29, 32], [71, 32], [66, 44], [58, 50], [50, 52], [42, 50], [34, 44]], "coral");
  p.curve([[30, 12], [29, 32], [36, 46], [50, 52], [64, 46], [71, 32], [70, 12]]);
  p.line(30, 12, 70, 12);
  p.line(30, 32, 70, 32);
  p.line(50, 52, 50, 86);
  p.ellipse(50, 88, 15, 3.5);
};

const plate: Primitive = (p) => {
  p.fillEllipse(50, 52, 19, 19, "sun");
  p.circle(50, 52, 29);
  p.circle(50, 52, 20);
  // fork
  p.line(12, 22, 12, 36).line(8, 22, 8, 34).line(16, 22, 16, 34);
  p.curve([[8, 34], [12, 40], [16, 34]]);
  p.line(12, 40, 12, 84);
  // knife
  p.poly([[88, 84], [88, 22], [93, 34], [92, 52], [88, 52]]);
};

const bowl: Primitive = (p) => {
  const body: Pt[] = [[14, 50], [20, 68], [34, 80], [50, 83], [66, 80], [80, 68], [86, 50]];
  p.fill(body, "sun");
  // chopsticks
  p.line(56, 46, 86, 10);
  p.line(62, 48, 92, 16);
  // rim + bowl
  p.ellipse(50, 50, 36, 6);
  p.curve(body);
  p.poly([[40, 83], [38, 90], [62, 90], [60, 83]]);
  // steam
  p.curve([[34, 40], [30, 32], [36, 24], [32, 16]]);
  p.curve([[48, 40], [44, 32], [50, 24], [46, 16]]);
};

const cake: Primitive = (p) => {
  p.fillRect(22, 50, 56, 36, "coral");
  p.poly([[22, 50], [22, 86], [78, 86], [78, 50]]);
  // drippy icing
  p.curve([[22, 50], [30, 50], [34, 60], [40, 52], [48, 58], [54, 51], [62, 60], [68, 51], [78, 50]]);
  p.line(22, 50, 78, 50);
  // plate
  p.line(12, 88, 88, 88);
  // candle + flame
  p.rect(47, 32, 6, 18);
  p.curve([[50, 28], [46, 23], [50, 15], [54, 23], [50, 28]]);
};

const icecream: Primitive = (p) => {
  const scoop = blob(
    [
      [50, 34, 17],
      [36, 44, 9],
      [64, 44, 9],
    ],
    50,
    38,
    50,
  );
  p.fill(scoop, "coral");
  p.poly(scoop, true);
  // cone
  p.poly([[34, 50], [50, 92], [66, 50]]);
  // waffle
  p.line(40, 52, 58, 72).line(52, 52, 62, 62);
  p.line(60, 52, 42, 72).line(48, 52, 38, 62);
};

const pizza: Primitive = (p) => {
  const slice: Pt[] = [[22, 26], [78, 26], [50, 90]];
  p.fill(slice, "sun");
  p.poly([[22, 26], [50, 90], [78, 26]]);
  // crust
  p.curve([[18, 26], [34, 12], [66, 12], [82, 26]]);
  p.line(20, 26, 80, 26);
  // pepperoni
  p.circle(38, 38, 5).circle(58, 40, 5).circle(49, 58, 4.5);
};

// ---------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------

const plane: Primitive = (p) => {
  const body: Pt[] = [
    [28, 44], [80, 44], ...arc(80, 51, 12, 7, -90, 180, 8).slice(1), [20, 58], [12, 54], [8, 30], [16, 30],
  ];
  p.fill(body, "sky");
  p.poly(body, true);
  // near wing (swept back, toward us) and far wing
  p.poly([[58, 57], [40, 78], [32, 78], [44, 57]]);
  p.poly([[54, 44], [44, 30], [38, 30], [44, 44]]);
  // tailplane
  p.poly([[14, 48], [26, 48], [18, 52]]);
  // cockpit + windows
  p.line(82, 48, 88, 48);
  for (const x of [34, 42, 50, 58, 66, 74]) p.dot(x, 49, 1.3);
};

const car: Primitive = (p) => {
  p.fill([[10, 70], [10, 58], [22, 54], [32, 40], [66, 40], [76, 54], [90, 58], [90, 70]], "coral");
  p.poly(
    [
      [19, 70], [10, 70], [10, 58], [22, 54], [32, 40], [66, 40], [76, 54], [90, 58], [90, 70], [81, 70],
      ...arc(71, 71, 10, 10, 0, -180, 8).slice(1, -1),
      [61, 70], [39, 70],
      ...arc(29, 71, 10, 10, 0, -180, 8).slice(1, -1),
    ],
    true,
  );
  // windows
  p.poly([[34, 44], [47, 44], [47, 54], [26, 54]], true);
  p.poly([[52, 44], [64, 44], [71, 54], [52, 54]], true);
  // wheels
  p.circle(29, 72, 7.5);
  p.circle(71, 72, 7.5);
  p.line(4, 80, 96, 80);
};

const train: Primitive = (p) => {
  const body = roundRect(26, 12, 48, 68, 10);
  p.fill(body, "sky");
  p.poly(body, true);
  // windscreen
  p.poly(roundRect(33, 22, 34, 22, 3), true);
  // lights + number plate
  p.circle(37, 64, 4);
  p.circle(63, 64, 4);
  p.line(44, 54, 56, 54);
  // rails
  p.line(38, 80, 26, 92);
  p.line(62, 80, 74, 92);
  p.line(32, 86, 68, 86);
};

const bike: Primitive = (p) => {
  const R: Pt = [27, 70];
  const B: Pt = [50, 70];
  const S: Pt = [43, 46];
  const H: Pt = [68, 47];
  const F: Pt = [74, 70];
  p.fill([S, H, B], "leaf");
  p.circle(R[0], R[1], 17);
  p.circle(F[0], F[1], 17);
  p.poly([R, B, S], true);
  p.poly([S, H, B]);
  p.line(H[0], H[1], F[0], F[1]);
  // bars + saddle
  p.curve([[68, 47], [66, 38], [72, 36], [77, 38]]);
  p.line(43, 46, 42, 38);
  p.line(36, 37, 48, 37);
};

const boat: Primitive = (p) => {
  const hull: Pt[] = [[14, 68], [86, 68], [74, 82], [26, 82]];
  p.fill(hull, "sky");
  p.poly(hull, true);
  p.line(50, 68, 50, 12);
  p.poly([[53, 14], [53, 62], [82, 62]], true);
  p.poly([[47, 22], [47, 62], [24, 62]], true);
  p.curve([[8, 89], [18, 86], [28, 89], [38, 86], [48, 89], [58, 86], [68, 89], [78, 86], [92, 89]]);
};

const suitcase: Primitive = (p) => {
  const body = roundRect(16, 34, 68, 50, 6);
  p.fill(body, "coral");
  p.poly(body, true);
  p.poly([[40, 34], [40, 22], [60, 22], [60, 34]]);
  p.line(32, 34, 32, 84);
  p.line(68, 34, 68, 84);
  p.circle(26, 88, 3).circle(74, 88, 3);
};

const ticket: Primitive = (p) => {
  const tilt = -10 + p.between(-3, 3);
  const outline: Pt[] = rot(
    [
      [12, 30], [88, 30],
      ...arc(88, 50, 6, 6, -90, -180, 8).slice(1, -1),
      [88, 70], [12, 70],
      ...arc(12, 50, 6, 6, 90, -180, 8).slice(1, -1),
    ],
    tilt,
  );
  p.fill(outline, "sun");
  p.poly(outline, true);
  // perforation
  for (let y = 33; y < 68; y += 7) {
    const [a, b] = rot([[66, y], [66, y + 3.5]], tilt);
    p.line(a[0], a[1], b[0], b[1]);
  }
  // a star and a line of print
  p.poly(rot(starPts(77, 50, 7, 3), tilt), true);
  const [l1, l2, l3, l4] = rot([[24, 44], [54, 44], [24, 56], [46, 56]], tilt);
  p.line(l1[0], l1[1], l2[0], l2[1]);
  p.line(l3[0], l3[1], l4[0], l4[1]);
};

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** One simple figure: round head, a shirt, stick arms and legs. */
function figure(p: Pen, x: number, s: number, arms: "down" | "wave" | "left" | "right", fill = true) {
  const y0 = 90;
  const Y = (v: number) => y0 - v * s; // height above the ground
  const X = (v: number) => x + v * s;
  const shirt: Pt[] = [[X(-10), Y(46)], [X(10), Y(46)], [X(12), Y(26)], [X(-12), Y(26)]];
  if (fill) p.fill(shirt, "coral");
  p.circle(x, Y(58), 9 * s);
  p.poly(shirt, true);
  // legs
  p.line(X(-5), Y(26), X(-6), y0);
  p.line(X(5), Y(26), X(6), y0);
  // arms
  const armL: Pt = arms === "left" ? [X(-22), Y(30)] : [X(-15), Y(24)];
  const armR: Pt = arms === "wave" ? [X(20), Y(62)] : arms === "right" ? [X(22), Y(30)] : [X(15), Y(24)];
  p.line(X(-10), Y(44), armL[0], armL[1]);
  p.line(X(10), Y(44), armR[0], armR[1]);
}

const person: Primitive = (p) => {
  figure(p, 50, 1.25, "wave");
};

const people: Primitive = (p) => {
  // fills first, so both shirts sit under all the ink
  const s1 = 1.2;
  const s2 = 1.02;
  const shirt = (x: number, s: number): Pt[] => [
    [x - 10 * s, 90 - 46 * s], [x + 10 * s, 90 - 46 * s], [x + 12 * s, 90 - 26 * s], [x - 12 * s, 90 - 26 * s],
  ];
  p.fill(shirt(33, s1), "coral");
  p.fill(shirt(68, s2), "coral");
  figure(p, 33, s1, "right", false);
  figure(p, 68, s2, "left", false);
};

const heart: Primitive = (p) => {
  const pts: Pt[] = [];
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([50 + x * 2.3, 44 - y * 2.3]);
  }
  p.fill(pts, "coral");
  p.curve(pts, true);
};

const dog: Primitive = (p) => {
  const body: Pt[] = [[28, 52], [48, 50], [66, 50], [74, 58], [72, 70], [60, 72], [36, 72], [26, 66], [24, 58]];
  p.fill(body, "sun");
  p.curve(body, true);
  // head, snout to the right
  p.curve([[66, 50], [64, 38], [70, 28], [80, 28], [86, 34], [92, 38], [91, 44], [82, 46], [72, 52]]);
  // floppy ear
  p.curve([[72, 30], [66, 36], [66, 46], [71, 44]]);
  p.dot(92, 39, 2).dot(80, 35, 1.5);
  // legs
  p.line(32, 70, 30, 88).line(40, 72, 40, 88).line(60, 72, 60, 88).line(68, 70, 71, 88);
  // tail, up and wagging
  p.curve([[25, 56], [16, 50], [14, 40], [18, 34]]);
};

const cat: Primitive = (p) => {
  const head: Pt[] = [
    [26, 50], [24, 18], [42, 32], [50, 31], [58, 32], [76, 18], [74, 50],
    ...arc(50, 52, 24, 26, 0, 180, 10).slice(1, -1),
  ];
  p.fill(head, "sun");
  p.poly(head, true);
  // eyes, nose, mouth
  p.dot(40, 52, 2.2).dot(60, 52, 2.2);
  p.poly([[47, 60], [53, 60], [50, 63]], true);
  p.curve([[43, 66], [47, 69], [50, 64], [53, 69], [57, 66]]);
  // whiskers
  p.line(30, 60, 12, 56).line(30, 65, 12, 68);
  p.line(70, 60, 88, 56).line(70, 65, 88, 68);
};

// ---------------------------------------------------------------------------
// Things
// ---------------------------------------------------------------------------

const camera: Primitive = (p) => {
  p.poly(roundRect(12, 34, 76, 50, 6), true);
  p.poly([[34, 34], [39, 24], [59, 24], [64, 34]]);
  p.circle(50, 59, 17);
  p.circle(50, 59, 9);
  p.rect(70, 40, 10, 6);
  p.poly([[19, 34], [19, 29], [28, 29], [28, 34]]);
};

const music: Primitive = (p) => {
  p.fillEllipse(30, 74, 9, 7, "sky");
  p.fillEllipse(68, 66, 9, 7, "sky");
  p.ellipse(30, 74, 9, 7);
  p.ellipse(68, 66, 9, 7);
  p.line(39, 73, 39, 24);
  p.line(77, 65, 77, 16);
  p.poly([[39, 24], [77, 16]]);
  p.poly([[39, 33], [77, 25]]);
};

const book: Primitive = (p) => {
  const spread: Pt[] = [[50, 34], [30, 26], [12, 30], [12, 78], [30, 74], [50, 82], [70, 74], [88, 78], [88, 30], [70, 26]];
  p.fill(spread, "leaf");
  p.curve([[50, 34], [30, 24], [12, 30]]);
  p.curve([[50, 34], [70, 24], [88, 30]]);
  p.line(12, 30, 12, 78);
  p.line(88, 30, 88, 78);
  p.curve([[12, 78], [32, 72], [50, 82]]);
  p.curve([[88, 78], [68, 72], [50, 82]]);
  p.line(50, 34, 50, 82);
  // lines of text
  p.line(20, 42, 42, 44).line(20, 52, 42, 54).line(58, 44, 80, 42).line(58, 54, 80, 52);
};

const gift: Primitive = (p) => {
  p.fillRect(20, 46, 60, 42, "coral");
  p.poly([[20, 46], [20, 88], [80, 88], [80, 46]]);
  p.rect(14, 34, 72, 12);
  // ribbon
  p.line(50, 34, 50, 88);
  // bow
  p.curve([[50, 34], [38, 18], [28, 26], [36, 34], [50, 34]]);
  p.curve([[50, 34], [62, 18], [72, 26], [64, 34], [50, 34]]);
};

const ball: Primitive = (p) => {
  p.fillEllipse(50, 50, 34, 34, "sun");
  p.circle(50, 50, 34);
  p.line(16, 50, 84, 50);
  p.curve([[50, 16], [54, 50], [50, 84]]);
  p.ellipse(10, 50, 30, 26, -58, 116);
  p.ellipse(90, 50, 30, 26, 122, 116);
};

const art: Primitive = (p) => {
  const palette: Pt[] = [[20, 40], [36, 24], [62, 22], [84, 34], [88, 54], [78, 70], [60, 78], [48, 72], [40, 78], [26, 76], [16, 60]];
  p.fill(palette, "coral");
  p.curve(palette, true);
  p.ellipse(34, 60, 6, 5);
  p.circle(42, 36, 5).circle(60, 34, 5).circle(74, 44, 5);
  // brush
  p.line(56, 70, 86, 92);
  p.curve([[56, 70], [50, 62], [48, 58], [53, 62], [58, 67]]);
};

const shopping: Primitive = (p) => {
  const bag: Pt[] = [[22, 40], [78, 40], [82, 90], [18, 90]];
  p.fill(bag, "sun");
  p.poly(bag, true);
  p.ellipse(40, 42, 7, 16, 180, 180);
  p.ellipse(60, 42, 7, 16, 180, 180);
};


// ---------------------------------------------------------------------------
// More things, places and creatures
// ---------------------------------------------------------------------------

const umbrella: Primitive = (p) => {
  // canopy: a dome with three scallops underneath
  const top = arc(50, 52, 38, 34, 180, 180, 16);
  const scallops: Pt[] = [
    ...arc(75.3, 52, 12.7, 6, 0, -180, 5),
    ...arc(50, 52, 12.7, 6, 0, -180, 5).slice(1),
    ...arc(24.7, 52, 12.7, 6, 0, -180, 5).slice(1),
  ];
  p.fill([...top, ...scallops], "blush");
  p.curve(top);
  p.curve(scallops);
  p.line(50, 18, 50, 12);
  // ribs
  p.curve([[50, 18], [42, 34], [37.4, 52]]);
  p.curve([[50, 18], [58, 34], [62.6, 52]]);
  // handle
  p.curve([[50, 52], [50, 70], [50, 84], [46, 90], [40, 88], [39, 82]]);
};

const balloon: Primitive = (p) => {
  p.fillEllipse(50, 36, 23, 27, "blush");
  p.ellipse(50, 36, 23, 27);
  p.poly([[46, 66], [54, 66], [50, 62]], true);
  p.curve([[50, 66], [44, 74], [55, 82], [47, 92]]);
  // shine
  p.ellipse(50, 36, 14, 18, 200, 55);
};

const candle: Primitive = (p) => {
  p.fillRect(38, 42, 24, 44, "sun");
  p.poly([[38, 44], [38, 86], [62, 86], [62, 44]]);
  // the top, with a drip
  p.curve([[38, 44], [46, 46], [50, 44], [55, 46], [55, 54], [58, 55], [59, 46], [62, 44]]);
  p.line(50, 44, 50, 36);
  // flame
  const flame: Pt[] = [[50, 10], [57, 22], [56, 30], [50, 35], [44, 30], [43, 22]];
  p.fill(flame, "coral");
  p.curve(flame, true);
  // saucer
  p.ellipse(50, 88, 24, 4.5);
};

const kite: Primitive = (p) => {
  const body: Pt[] = [[52, 8], [78, 34], [52, 66], [26, 34]];
  p.fill(body, "lilac");
  p.poly(body, true);
  p.line(52, 8, 52, 66);
  p.line(26, 34, 78, 34);
  // tail with bows
  p.curve([[52, 66], [44, 74], [54, 82], [46, 92]]);
  p.line(44, 72, 50, 76).line(50, 72, 44, 76);
  p.line(49, 84, 55, 88).line(55, 84, 49, 88);
};

const headphones: Primitive = (p) => {
  p.fill(roundRect(12, 52, 16, 28, 6), "lilac");
  p.fill(roundRect(72, 52, 16, 28, 6), "lilac");
  p.curve(arc(50, 56, 34, 38, 180, 180, 14));
  p.curve(arc(50, 56, 28, 32, 185, 170, 12));
  p.poly(roundRect(12, 52, 16, 28, 6), true);
  p.poly(roundRect(72, 52, 16, 28, 6), true);
};

const guitar: Primitive = (p) => {
  const body = blob(
    [
      [50, 70, 20],
      [50, 44, 14],
    ],
    50,
    60,
  );
  p.fill(body, "sun");
  p.poly(body, true);
  p.circle(50, 58, 6);
  // neck and head
  p.poly([[46.5, 32], [46.5, 12], [53.5, 12], [53.5, 32]]);
  p.poly(roundRect(44, 4, 12, 9, 2), true);
  p.line(50, 12, 50, 82);
  p.line(42, 80, 58, 80);
};

const sunglasses: Primitive = (p) => {
  const left = roundRect(10, 40, 34, 24, 9);
  const right = roundRect(56, 40, 34, 24, 9);
  p.fill(left, "lilac");
  p.fill(right, "lilac");
  p.poly(left, true);
  p.poly(right, true);
  p.curve([[44, 46], [50, 41], [56, 46]]);
  p.line(10, 45, 4, 36).line(90, 45, 96, 36);
  // glints
  p.line(18, 46, 24, 52).line(64, 46, 70, 52);
};

const lighthouse: Primitive = (p) => {
  const tower: Pt[] = [[40, 36], [60, 36], [64, 86], [36, 86]];
  p.fill([[39, 50], [61, 50], [62, 62], [38, 62]], "coral");
  p.fill([[37, 74], [63, 74], [64, 86], [36, 86]], "coral");
  p.poly(tower, true);
  p.line(39, 50, 61, 50).line(38, 62, 62, 62).line(37, 74, 63, 74);
  // lantern and roof
  p.rect(42, 24, 16, 12);
  p.poly([[38, 24], [50, 12], [62, 24]], true);
  // light
  p.line(34, 28, 20, 24).line(66, 28, 80, 24).line(34, 32, 22, 36).line(66, 32, 78, 36);
  // the sea
  p.curve([[10, 90], [22, 86], [34, 91], [50, 88], [66, 91], [78, 86], [90, 90]]);
};

const rainbow: Primitive = (p) => {
  const outer = arc(50, 76, 40, 40, 180, 180, 16);
  const inner = arc(50, 76, 28, 28, 0, -180, 14);
  p.fill([...outer, ...inner], "sky");
  p.curve(outer);
  p.curve(arc(50, 76, 34, 34, 180, 180, 14));
  p.curve(arc(50, 76, 28, 28, 180, 180, 14));
  // clouds at the feet
  p.curve(blob([[14, 78, 7], [22, 76, 8], [30, 79, 6]], 22, 78, 82), true);
  p.curve(blob([[70, 79, 6], [78, 76, 8], [86, 78, 7]], 78, 78, 82), true);
};

const bird: Primitive = (p) => {
  const body: Pt[] = [[20, 54], [30, 44], [48, 42], [62, 48], [70, 58], [60, 68], [42, 70], [28, 64]];
  p.fill(body, "sky");
  p.curve(body, true);
  p.circle(66, 40, 10);
  p.poly([[75, 37], [86, 40], [75, 43]], true);
  p.dot(68, 38, 1.8);
  // wing and tail
  p.curve([[36, 52], [46, 46], [56, 54], [44, 60]]);
  p.poly([[22, 54], [8, 46], [12, 62]], true);
  // legs
  p.line(44, 70, 42, 84).line(52, 69, 54, 84);
};

const fish: Primitive = (p) => {
  const body: Pt[] = [[16, 50], [30, 36], [52, 34], [70, 42], [78, 50], [70, 58], [52, 66], [30, 64]];
  p.fill(body, "sky");
  p.curve(body, true);
  p.poly([[77, 50], [92, 36], [90, 64]], true);
  p.dot(30, 47, 2.2);
  p.curve([[40, 40], [44, 50], [40, 60]]);
  // bubbles
  p.circle(12, 30, 3).circle(18, 20, 2.2);
};

const cactus: Primitive = (p) => {
  const trunk = roundRect(40, 20, 20, 60, 10);
  p.fill(trunk, "leaf");
  p.fill(roundRect(22, 40, 12, 24, 6), "leaf");
  p.fill(roundRect(66, 32, 12, 22, 6), "leaf");
  p.poly(trunk, true);
  // arms
  p.curve([[40, 60], [30, 60], [26, 56], [26, 42], [30, 38], [34, 42], [34, 52], [40, 52]]);
  p.curve([[60, 50], [70, 50], [74, 46], [74, 34], [70, 30], [66, 34], [66, 42], [60, 42]]);
  // spines
  p.line(47, 32, 45, 30).line(53, 44, 55, 42).line(47, 58, 45, 56).line(53, 68, 55, 66);
  // pot
  p.fill([[32, 80], [68, 80], [64, 92], [36, 92]], "coral");
  p.poly([[32, 80], [68, 80], [64, 92], [36, 92]], true);
};

const hot_air_balloon: Primitive = (p) => {
  // envelope: round on top, narrowing to the mouth
  const envelope: Pt[] = [[36, 58], [22, 40], [22, 24], [32, 12], [50, 7], [68, 12], [78, 24], [78, 40], [64, 58]];
  p.fill(envelope, "coral");
  p.curve(envelope);
  p.line(36, 58, 64, 58);
  // gores
  p.curve([[50, 7], [42, 24], [42, 44], [45, 58]]);
  p.curve([[50, 7], [58, 24], [58, 44], [55, 58]]);
  // ropes and basket
  p.line(38, 59, 42, 76).line(62, 59, 58, 76);
  p.poly([[40, 76], [60, 76], [58, 90], [42, 90]], true);
  p.line(41, 82, 59, 82);
};

const croissant: Primitive = (p) => {
  const shape: Pt[] = [[10, 64], [18, 46], [36, 34], [50, 32], [64, 34], [82, 46], [90, 64], [76, 58], [64, 52], [50, 50], [36, 52], [24, 58]];
  p.fill(shape, "sun");
  p.curve(shape, true);
  p.curve([[32, 38], [36, 46], [38, 52]]);
  p.curve([[50, 33], [50, 42], [50, 50]]);
  p.curve([[68, 38], [64, 46], [62, 52]]);
};

// ---------------------------------------------------------------------------

export const PRIMITIVES: Record<DoodleId, Primitive> = {
  pin,
  map,
  tower,
  dome,
  arch,
  bridge,
  building,
  house,
  skyline,
  mountain,
  ferris_wheel,
  tent,
  sun,
  sunset,
  moon,
  cloud,
  rain,
  snow,
  wave,
  palm,
  tree,
  flower,
  leaf,
  clock,
  calendar,
  star,
  coffee,
  wine,
  plate,
  bowl,
  cake,
  icecream,
  pizza,
  plane,
  car,
  train,
  bike,
  boat,
  suitcase,
  ticket,
  person,
  people,
  heart,
  dog,
  cat,
  camera,
  music,
  book,
  gift,
  ball,
  art,
  shopping,
  umbrella,
  balloon,
  candle,
  kite,
  headphones,
  guitar,
  sunglasses,
  lighthouse,
  rainbow,
  bird,
  fish,
  cactus,
  croissant,
  hot_air_balloon,
};

/** Tiny marks with no meaning, for empty paper (DESIGN.md §5 "Scatter"). */
export const MARKS: Record<"spark" | "dots" | "twinkle" | "eye" | "crossed", Primitive> = {
  /** Seen: an open eye, drawn quickly. */
  eye: (p: Pen) => {
    p.fillEllipse(50, 50, 11, 11, "sky");
    p.curve([[10, 50], [30, 28], [50, 24], [70, 28], [90, 50]]);
    p.curve([[10, 50], [30, 72], [50, 76], [70, 72], [90, 50]]);
    p.circle(50, 50, 13);
    p.dot(50, 50, 4.5);
    p.line(50, 14, 50, 6).line(28, 20, 23, 12).line(72, 20, 77, 12);
  },
  /** Crossed paths: two circles overlapping, one with its marker (the mark's own shape). */
  crossed: (p: Pen) => {
    p.fillEllipse(38, 50, 22, 22, "coral");
    p.circle(38, 50, 24);
    p.circle(62, 50, 24);
    p.dot(50, 50, 3.4);
  },
  spark: (p: Pen) => {
    p.line(50, 30, 50, 70);
    p.line(30, 50, 70, 50);
    p.line(38, 38, 62, 62).line(62, 38, 38, 62);
  },
  dots: (p: Pen) => {
    p.dot(40, 44, 2.2).dot(56, 40, 1.8).dot(50, 58, 2);
  },
  twinkle: (p: Pen) => {
    p.curve([[50, 26], [53, 47], [74, 50], [53, 53], [50, 74], [47, 53], [26, 50], [47, 47]], true);
  },
};
