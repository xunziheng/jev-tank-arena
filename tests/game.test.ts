import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../web/src/game";
import {
  COLS,
  ROWS,
  center,
  blocked,
  astar,
  cell,
  distance,
  TILE,
} from "../web/src/navigation";
import type { DecisionResponse } from "../shared/types";
const noNetwork = async () => {
  throw Error("network should not run");
};
const openGrid = () =>
  Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) =>
      x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? 1 : 0,
    ),
  );
test("each round randomizes distant reachable tank spawns", () => {
  let seed = 0x12345678;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const g = new Game(noNetwork, () => 0, random);
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    g.reset("practice");
    const playerCell = cell(g.player),
      aiCell = cell(g.ai);
    seen.add(`${playerCell.x},${playerCell.y}:${aiCell.x},${aiCell.y}`);
    assert.equal(blocked(g.grid, g.player.x, g.player.y, 15), false);
    assert.equal(blocked(g.grid, g.ai.x, g.ai.y, 15), false);
    assert.ok(astar(g.grid, playerCell, aiCell).length >= 8);
    assert.ok(distance(g.player, g.ai) >= TILE * 6);
  }
  assert.ok(seen.size > 10);
  g.dispose();
});
test("movement cannot pass through walls", () => {
  const g = new Game(noNetwork);
  g.grid = openGrid();
  g.player = { ...g.player, ...center({ x: 1, y: 1 }) };
  for (let i = 0; i < 100; i++) g.move(g.player, -1, 0, 0.016);
  assert.equal(blocked(g.grid, g.player.x, g.player.y, 15), false);
  assert.ok(g.player.x >= 63);
  g.dispose();
});
test("bullets reflect off walls and can hit their owner after immunity", () => {
  const g = new Game(noNetwork);
  g.grid = openGrid();
  g.player = { ...g.player, x: 80, y: 72 };
  g.ai = { ...g.ai, x: 400, y: 400 };
  g.bullets = [
    { x: 53, y: 72, vx: -220, vy: 0, owner: "player", age: 0.3, bounces: 0 },
  ];
  g.stepProjectiles(0.02);
  assert.ok(g.bullets[0].vx > 0);
  for (let i = 0; i < 15; i++) g.stepProjectiles(0.016);
  assert.equal(g.player.hp, 2);
  g.dispose();
});
test("laser telegraphs before damaging and is stopped by walls", () => {
  const g = new Game(noNetwork);
  g.grid = openGrid();
  g.player = {
    ...g.player,
    x: 100,
    y: 100,
    weapon: "laser",
    ammo: 4,
    turret: 0,
  };
  g.ai = { ...g.ai, x: 250, y: 100 };
  g.shoot(g.player);
  g.stepProjectiles(0.5);
  assert.equal(g.ai.hp, 3);
  g.stepProjectiles(0.16);
  assert.equal(g.ai.hp, 1);
  assert.equal(g.player.ammo, 3);
  g.dispose();
});
test("armed mines hurt both sides and expire after detonation", () => {
  const g = new Game(noNetwork);
  g.grid = openGrid();
  g.player = { ...g.player, x: 100, y: 100 };
  g.ai = { ...g.ai, x: 135, y: 100 };
  g.mines = [{ x: 105, y: 100, age: 0, owner: "player" }];
  g.stepProjectiles(0.5);
  assert.equal(g.player.hp, 3);
  g.stepProjectiles(0.6);
  assert.equal(g.player.hp, 1);
  assert.equal(g.ai.hp, 1);
  assert.equal(g.mines.length, 0);
  g.dispose();
});
test("director only offers reachable pickups with near-equal route distance", () => {
  const g = new Game(noNetwork);
  for (const c of g.directorCandidates()) {
    if (!c.point) continue;
    assert.ok(
      Math.abs(
        astar(g.grid, cell(g.player), cell(c.point)).length -
          astar(g.grid, cell(g.ai), cell(c.point)).length,
      ) <= 3,
    );
  }
  g.dispose();
});
test("a late Jev response cannot affect a reset game", async () => {
  let resolve!: (v: DecisionResponse) => void;
  const g = new Game(() => new Promise((r) => (resolve = r)));
  const pending = g.think();
  g.reset();
  resolve({
    choice: "hold",
    confidence: 1,
    latencyMs: 10,
    model: "fixture",
    source: "jev",
    round: 1,
    revision: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
  });
  await pending;
  assert.equal(g.plan, null);
  assert.equal(g.calls, 0);
  g.dispose();
});
test("API failure does not silently switch to a rules AI", async () => {
  const g = new Game(async () => {
    throw Error("service offline");
  });
  await g.think();
  assert.equal(g.plan, null);
  assert.equal(g.mode, "jev");
  assert.equal(g.error, "service offline");
  assert.equal(g.pending, false);
  g.dispose();
});
test("practice mode runs without API calls and ends rounds", () => {
  const g = new Game(noNetwork);
  g.mode = "practice";
  g.grid = openGrid();
  g.running = true;
  for (let i = 0; i < 300; i++) g.update(0.016);
  assert.ok(g.logs.length > 0);
  assert.equal(g.calls, 0);
  g.score = [0, 0];
  g.roundOver = false;
  g.roundTimer = 0;
  g.player.hp = 3;
  g.ai.hp = 0;
  g.update(0.016);
  assert.deepEqual(g.score, [1, 0]);
  assert.equal(g.roundOver, true);
  g.dispose();
});
test("a wall blocks the actual laser beam damage", () => {
  const g = new Game(noNetwork);
  g.grid = openGrid();
  g.grid[2][4] = 1;
  g.player = {
    ...g.player,
    x: 120,
    y: 120,
    weapon: "laser",
    ammo: 4,
    turret: 0,
  };
  g.ai = { ...g.ai, x: 270, y: 120 };
  g.shoot(g.player);
  g.stepProjectiles(0.7);
  assert.equal(g.ai.hp, 3);
  g.dispose();
});
test("tanks cannot drive through one another", () => {
  const g = new Game(noNetwork);
  g.grid = openGrid();
  g.player = { ...g.player, x: 100, y: 100 };
  g.ai = { ...g.ai, x: 135, y: 100 };
  for (let i = 0; i < 50; i++) g.move(g.player, 1, 0, 0.016);
  assert.ok(g.ai.x - g.player.x >= 30);
  g.dispose();
});
