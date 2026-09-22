import type { Point } from "../../shared/types";
export const TILE = 48,
  COLS = 19,
  ROWS = 13,
  WIDTH = COLS * TILE,
  HEIGHT = ROWS * TILE;
export type Grid = number[][];
export const cell = (p: Point) => ({
  x: Math.floor(p.x / TILE),
  y: Math.floor(p.y / TILE),
});
export const center = (p: Point) => ({
  x: (p.x + 0.5) * TILE,
  y: (p.y + 0.5) * TILE,
});
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export function astar(
  grid: Grid,
  start: Point,
  end: Point,
  cost: (p: Point) => number = () => 0,
): Point[] {
  const valid = (p: Point) => grid[p.y]?.[p.x] === 0;
  if (!valid(start) || !valid(end)) return [];
  const key = (p: Point) => `${p.x},${p.y}`;
  const open = [start],
    parents = new Map<string, Point>(),
    g = new Map([[key(start), 0]]),
    closed = new Set<string>();
  const h = (p: Point) => Math.abs(p.x - end.x) + Math.abs(p.y - end.y);
  while (open.length) {
    open.sort((a, b) => g.get(key(a))! + h(a) - (g.get(key(b))! + h(b)));
    const current = open.shift()!,
      k = key(current);
    if (closed.has(k)) continue;
    if (k === key(end)) {
      const path = [current];
      let p = current;
      while (parents.has(key(p))) {
        p = parents.get(key(p))!;
        path.unshift(p);
      }
      return path;
    }
    closed.add(k);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { x: current.x + dx, y: current.y + dy },
        nk = key(next);
      if (!valid(next) || closed.has(nk)) continue;
      const score = g.get(k)! + 1 + Math.max(0, cost(next));
      if (score < (g.get(nk) ?? Infinity)) {
        g.set(nk, score);
        parents.set(nk, current);
        open.push(next);
      }
    }
  }
  return [];
}
export function makeArena(random: () => number = Math.random): Grid {
  const grid = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) =>
      x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? 1 : 0,
    ),
  );
  // Rotational symmetry gives equal spawn access; every floor must remain reachable.
  for (let y = 2; y < ROWS - 2; y++)
    for (let x = 2; x < COLS - 2; x++) {
      if (random() > 0.26 || (x === 9 && y === 6)) continue;
      const mirror = { x: COLS - 1 - x, y: ROWS - 1 - y };
      if (grid[y][x] || grid[mirror.y][mirror.x]) continue;
      grid[y][x] = grid[mirror.y][mirror.x] = 1;
      const seen = new Set<string>(),
        queue = [{ x: 1, y: 1 }];
      while (queue.length) {
        const p = queue.pop()!,
          k = `${p.x},${p.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const n = { x: p.x + dx, y: p.y + dy };
          if (grid[n.y]?.[n.x] === 0 && !seen.has(`${n.x},${n.y}`))
            queue.push(n);
        }
      }
      if (seen.size !== grid.flat().filter((v) => v === 0).length)
        grid[y][x] = grid[mirror.y][mirror.x] = 0;
    }
  return grid;
}
export function blocked(grid: Grid, x: number, y: number, r = 0): boolean {
  for (
    let cy = Math.floor((y - r) / TILE);
    cy <= Math.floor((y + r) / TILE);
    cy++
  )
    for (
      let cx = Math.floor((x - r) / TILE);
      cx <= Math.floor((x + r) / TILE);
      cx++
    ) {
      if (grid[cy]?.[cx] === 0) continue;
      const nearestX = Math.max(cx * TILE, Math.min(x, (cx + 1) * TILE));
      const nearestY = Math.max(cy * TILE, Math.min(y, (cy + 1) * TILE));
      if (Math.hypot(x - nearestX, y - nearestY) <= r) return true;
    }
  return false;
}
export function rayEnd(
  grid: Grid,
  from: Point,
  angle: number,
  max = 1200,
): Point {
  for (let d = 0; d <= max; d += 3) {
    const p = {
      x: from.x + Math.cos(angle) * d,
      y: from.y + Math.sin(angle) * d,
    };
    if (blocked(grid, p.x, p.y)) return p;
  }
  return {
    x: from.x + Math.cos(angle) * max,
    y: from.y + Math.sin(angle) * max,
  };
}
export function visible(grid: Grid, a: Point, b: Point): boolean {
  return (
    distance(
      a,
      rayEnd(grid, a, Math.atan2(b.y - a.y, b.x - a.x), distance(a, b)),
    ) >=
    distance(a, b) - 4
  );
}
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}
