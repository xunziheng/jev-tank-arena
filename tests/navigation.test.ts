import { test } from "node:test";
import assert from "node:assert/strict";
import {
  astar,
  makeArena,
  blocked,
  center,
  visible,
} from "../web/src/navigation";
test("A* takes a detour around walls and reports unreachable goals", () => {
  const grid = [
    [0, 0, 0],
    [0, 1, 0],
    [0, 1, 0],
  ];
  const path = astar(grid, { x: 0, y: 2 }, { x: 2, y: 2 });
  assert.equal(path.length, 7);
  assert.ok(path.every((p) => grid[p.y][p.x] === 0));
  assert.deepEqual(astar([[0, 1, 0]], { x: 0, y: 0 }, { x: 2, y: 0 }), []);
});
test("A* avoids a high-cost mined cell even when the alternative is longer", () => {
  const grid = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  const path = astar(grid, { x: 0, y: 0 }, { x: 2, y: 0 }, (p) =>
    p.x === 1 && p.y === 0 ? 20 : 0,
  );
  assert.equal(path.length, 5);
  assert.ok(!path.some((p) => p.x === 1 && p.y === 0));
});
test("generated arenas are connected, symmetric, and fit tank radius", () => {
  for (let seed = 1; seed <= 20; seed++) {
    let n = seed;
    const grid = makeArena(() => {
      n = (n * 16807) % 2147483647;
      return n / 2147483647;
    });
    for (let y = 0; y < grid.length; y++)
      for (let x = 0; x < grid[0].length; x++) {
        assert.equal(
          grid[y][x],
          grid[grid.length - 1 - y][grid[0].length - 1 - x],
        );
        if (!grid[y][x]) {
          assert.ok(astar(grid, { x: 1, y: 1 }, { x, y }).length);
          const p = center({ x, y });
          assert.equal(blocked(grid, p.x, p.y, 15), false);
        }
      }
  }
});
test("line of sight stops at a wall", () => {
  const grid = [
    [1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ];
  assert.equal(
    visible(grid, center({ x: 1, y: 1 }), center({ x: 3, y: 1 })),
    false,
  );
  assert.equal(
    visible(grid, center({ x: 1, y: 2 }), center({ x: 3, y: 2 })),
    true,
  );
});
