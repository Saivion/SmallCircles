/**
 * Cell geometry shared with the frontend by convention.
 * A cell is a 320x320 world-space square; a circle (240px) sits inset by 40px.
 */
export const CELL_W = 460;
export const CELL_H = 460;
/** A circle is 240px across, so it sits inset by this much in its cell. */
export const CELL_INSET = (CELL_W - 240) / 2;

export function makeCell(col: number, row: number): string {
  return `${Math.trunc(col)},${Math.trunc(row)}`;
}

export function parseCell(id: string): { col: number; row: number } {
  const [c, r] = id.split(",");
  const col = Number.parseInt(c ?? "", 10);
  const row = Number.parseInt(r ?? "", 10);
  if (!Number.isFinite(col) || !Number.isFinite(row)) {
    throw new Error(`bad cell id: ${id}`);
  }
  return { col, row };
}

/**
 * Nearest untaken cell in a square spiral starting at `startCell`.
 * Ring 0 is the start cell itself. Throws if nothing free within maxRing.
 */
export function spiralEmpty(
  startCell: string,
  isTaken: (cell: string) => boolean,
  maxRing = 40,
): string {
  const { col: c0, row: r0 } = parseCell(startCell);
  if (!isTaken(startCell)) return startCell;
  for (let ring = 1; ring <= maxRing; ring++) {
    // Walk the perimeter of the ring, top row -> right col -> bottom row -> left col.
    for (let dc = -ring; dc <= ring; dc++) {
      const cell = makeCell(c0 + dc, r0 - ring);
      if (!isTaken(cell)) return cell;
    }
    for (let dr = -ring + 1; dr <= ring; dr++) {
      const cell = makeCell(c0 + ring, r0 + dr);
      if (!isTaken(cell)) return cell;
    }
    for (let dc = ring - 1; dc >= -ring; dc--) {
      const cell = makeCell(c0 + dc, r0 + ring);
      if (!isTaken(cell)) return cell;
    }
    for (let dr = ring - 1; dr >= -ring + 1; dr--) {
      const cell = makeCell(c0 - ring, r0 + dr);
      if (!isTaken(cell)) return cell;
    }
  }
  throw new Error("no free cell within spiral range");
}

/** Islands start on row 2 (circles sit on row 0) and are placed by spiral search. */
export const ISLAND_START_CELL = "0,2";
export const ISLAND_MIN_ROW = 2;
export const ISLAND_INSET = 20;
/** Cell stride so board stacks (≈2 cells wide, several tall) do not collide. */
export const BOARD_STRIDE_COL = 2;
export const BOARD_STRIDE_ROW = 3;

/**
 * Next free board anchor in a 2D constellation (spiral rings with stride),
 * not a single horizontal hallway. Rings walk out from (0, ISLAND_MIN_ROW).
 */
export function islandCell(taken: Set<string>): string {
  const originCol = 0;
  const originRow = ISLAND_MIN_ROW;
  const tryCell = (col: number, row: number) => {
    const cell = makeCell(col, row);
    return taken.has(cell) ? null : cell;
  };
  const hit = tryCell(originCol, originRow);
  if (hit) return hit;
  for (let ring = 1; ring <= 24; ring++) {
    for (let i = -ring; i <= ring; i++) {
      const top = tryCell(originCol + i * BOARD_STRIDE_COL, originRow - ring * BOARD_STRIDE_ROW);
      if (top) return top;
      const bottom = tryCell(originCol + i * BOARD_STRIDE_COL, originRow + ring * BOARD_STRIDE_ROW);
      if (bottom) return bottom;
    }
    for (let i = -ring + 1; i <= ring - 1; i++) {
      const left = tryCell(originCol - ring * BOARD_STRIDE_COL, originRow + i * BOARD_STRIDE_ROW);
      if (left) return left;
      const right = tryCell(originCol + ring * BOARD_STRIDE_COL, originRow + i * BOARD_STRIDE_ROW);
      if (right) return right;
    }
  }
  return spiralEmpty(ISLAND_START_CELL, (cell) => taken.has(cell));
}

/** True when every board sits on the same row (legacy hallway layout). */
export function isHallwayLayout(cells: string[]): boolean {
  if (cells.length < 2) return false;
  const rows = new Set(cells.map((c) => parseCell(c).row));
  return rows.size === 1;
}

/** Recompute constellation cells/origins for a list of boards in order. */
export function constellationPlacement(count: number): { cell: string; originX: number; originY: number }[] {
  const taken = new Set<string>();
  const out: { cell: string; originX: number; originY: number }[] = [];
  for (let i = 0; i < count; i++) {
    const cell = islandCell(taken);
    taken.add(cell);
    out.push({ cell, ...islandOrigin(cell) });
  }
  return out;
}

/** Top-left of an island's card grid, in world px. */
export function islandOrigin(cell: string): { originX: number; originY: number } {
  const { col, row } = parseCell(cell);
  return { originX: col * CELL_W + ISLAND_INSET, originY: row * CELL_H + ISLAND_INSET };
}
