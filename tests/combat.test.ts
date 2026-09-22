import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../web/src/game";
import { COLS, ROWS, distance, blocked } from "../web/src/navigation";
import {
  advanceProjectile,
  assessMotion,
  findShot,
  forecastHazards,
  interceptTime,
  decisionInterval,
  type Observation,
  type Projectile,
} from "../web/src/combat";
import type { DecisionResponse, Plan } from "../shared/types";
const grid = () =>
  Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) =>
      x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? 1 : 0,
    ),
  );
const noNetwork = async () => {
  throw Error("offline fixture");
};
const observation = (x: number, y: number, vx = 0, vy = 0): Observation => ({
  x,
  y,
  velocity: { x: vx, y: vy },
  seenAt: 0,
});
const plan = (fire = false): Plan => ({
  id: "fire",
  label: "fixture",
  description: "fixture",
  target: { x: 240, y: 240 },
  path: [],
  aim: 0,
  risk: 0,
  fire,
  attack: "auto",
});
const response = (choice: string): DecisionResponse => ({
  choice,
  confidence: 0.9,
  latencyMs: 40,
  model: "fixture",
  source: "jev",
  round: 1,
  revision: 0,
  usage: { input_tokens: 1, output_tokens: 1 },
});
test("lead intercept reaches a laterally moving target rather than its old position", () => {
  const shooter = { x: 150, y: 250 },
    target = observation(350, 250, 0, 80),
    map = grid();
  const time = interceptTime(shooter, target, target.velocity);
  assert.ok(time > 200 / 220);
  const shot = findShot(map, shooter, target, "normal", "direct");
  assert.ok(shot);
  assert.ok(shot.angle > 0.2);
  const b: Projectile = {
    x: shooter.x + Math.cos(shot.angle) * 23,
    y: shooter.y + Math.sin(shot.angle) * 23,
    vx: Math.cos(shot.angle) * 220,
    vy: Math.sin(shot.angle) * 220,
    age: 0,
    bounces: 0,
    owner: "ai",
  };
  let hit = false;
  for (let t = 0; t < 1.4; t += 0.005)
    advanceProjectile(map, b, 0.005, (p) => {
      if (distance(p, { x: 350, y: 250 + 80 * p.age }) < 17) hit = true;
      return true;
    });
  assert.equal(hit, true);
});
test("one-bounce planner finds and physically verifies a wall shot", () => {
  const map = grid();
  const shooter = { x: 130, y: 110 },
    target = observation(300, 110);
  const shot = findShot(map, shooter, target, "normal", "bank");
  assert.ok(shot);
  assert.equal(shot.bounces, 1);
  const b: Projectile = {
    x: shooter.x + Math.cos(shot.angle) * 23,
    y: shooter.y + Math.sin(shot.angle) * 23,
    vx: Math.cos(shot.angle) * 220,
    vy: Math.sin(shot.angle) * 220,
    age: 0,
    bounces: 0,
    owner: "ai",
  };
  let hit = false;
  for (let t = 0; t < 1.8 && !hit; t += 0.005)
    advanceProjectile(map, b, 0.005, (p) => {
      if (distance(p, target) < 17 && p.bounces === 1) hit = true;
      return true;
    });
  assert.equal(hit, true);
});
test("forecast includes wall reflections and shares live projectile integration", () => {
  const map = grid(),
    b: Projectile = {
      x: 70,
      y: 120,
      vx: -220,
      vy: 0,
      owner: "player",
      age: 0.4,
      bounces: 0,
    };
  const hazards = forecastHazards(map, [b], [], []);
  const live = { ...b };
  for (const p of hazards[0].points.slice(1)) {
    advanceProjectile(map, live, 0.025);
    assert.ok(distance(live, p) < 1e-6);
  }
  const risk = assessMotion(map, { x: 140, y: 120 }, [], hazards);
  assert.ok(risk.risk > 0);
  assert.ok(risk.hitIn !== null);
});
test("rollout rejects paths crossing bullets even if the endpoint looks safe", () => {
  const map = grid();
  const h = forecastHazards(
    map,
    [{ x: 220, y: 110, vx: 0, vy: 220, owner: "player", age: 1, bounces: 0 }],
    [],
    [],
  );
  const risk = assessMotion(map, { x: 170, y: 200 }, [{ x: 300, y: 200 }], h);
  assert.ok(risk.risk > 0);
});
test("laser telegraphs and armed mines enter danger assessment", () => {
  const map = grid();
  const laser = forecastHazards(
    map,
    [],
    [],
    [
      {
        from: { x: 100, y: 240 },
        to: { x: 400, y: 240 },
        age: 0.2,
        owner: "player",
        fired: false,
      },
    ],
  );
  assert.ok(assessMotion(map, { x: 240, y: 240 }, [], laser).risk > 0);
  assert.equal(
    assessMotion(map, { x: 240, y: 240 }, [{ x: 240, y: 350 }], laser).risk,
    0,
  );
  const mines = forecastHazards(map, [], [{ x: 280, y: 240, age: 2 }], []);
  assert.ok(
    assessMotion(map, { x: 240, y: 240 }, [{ x: 350, y: 240 }], mines).risk > 0,
  );
});
test("local reflex avoids an incoming bullet while Jev is pending", () => {
  const g = new Game(noNetwork);
  g.grid = grid();
  g.ai = { ...g.ai, x: 240, y: 240 };
  g.player = { ...g.player, x: 700, y: 500 };
  g.running = true;
  g.pending = true;
  g.nextDirector = Infinity;
  g.bullets = [
    { x: 120, y: 240, vx: 220, vy: 0, owner: "player", age: 1, bounces: 0 },
  ];
  for (let i = 0; i < 70; i++) g.update(0.016);
  assert.equal(g.ai.hp, 3);
  assert.ok(g.reflexCount > 0);
  assert.ok(Math.abs(g.ai.y - 240) > 15);
  assert.equal(g.calls, 0);
  assert.equal(g.plan, null);
  g.dispose();
});
test("aim tracks observed movement without another Jev call, and hidden positions do not leak", () => {
  const g = new Game(noNetwork);
  g.grid = grid();
  g.ai = { ...g.ai, x: 120, y: 240 };
  g.player = { ...g.player, x: 300, y: 240 };
  g.time = 1;
  g.observeEnemy(0.016);
  g.applyPlan(plan(true));
  g.time += 0.016;
  g.player.y += 1.5;
  g.observeEnemy(0.016);
  g.executeCombat(0.016);
  assert.ok(g.ai.turret > 0.1);
  assert.equal(g.calls, 0);
  for (let y = 1; y < ROWS - 1; y++) g.grid[y][4] = 1;
  const seen = { ...g.observed! };
  g.player.y = 450;
  g.time += 0.016;
  g.observeEnemy(0.016);
  assert.equal(g.enemyVisible, false);
  assert.deepEqual(g.observed, seen);
  g.ai.cooldown = 0;
  const count = g.bullets.length;
  g.executeCombat(0.016);
  assert.equal(g.bullets.length, count);
  g.dispose();
});
test("no plan grants no attack permission even when the enemy is visible", () => {
  const g = new Game(noNetwork);
  g.grid = grid();
  g.ai = { ...g.ai, x: 120, y: 240 };
  g.player = { ...g.player, x: 300, y: 240 };
  g.observeEnemy(0.016);
  g.executeCombat(0.016);
  assert.equal(g.bullets.length, 0);
  g.dispose();
});
test("adaptive cadence uses combat, pursuit and search bands", () => {
  assert.equal(decisionInterval(true, false, false), 0.25);
  assert.equal(decisionInterval(false, true, false), 0.25);
  assert.equal(decisionInterval(false, false, true), 0.5);
  assert.equal(decisionInterval(false, false, false), 0.9);
});
test("one in-flight request and wall-clock minimum survive event storms", async () => {
  let finish!: (r: DecisionResponse) => void,
    count = 0,
    now = 0;
  const g = new Game(
    () => {
      count++;
      return new Promise((r) => (finish = r));
    },
    () => now,
  );
  const first = g.think();
  await g.think();
  assert.equal(count, 1);
  finish(response("hold"));
  await first;
  now = 100;
  await g.think();
  assert.equal(count, 1);
  now = 250;
  const second = g.think();
  assert.equal(count, 2);
  finish(response("hold"));
  await second;
  g.dispose();
});
test("expired decision is counted but never executed and is replanned", async () => {
  let now = 0,
    finish!: (r: DecisionResponse) => void;
  const g = new Game(
    () => new Promise((r) => (finish = r)),
    () => now,
  );
  const pending = g.think();
  now = 1900;
  finish(response("hold"));
  await pending;
  assert.equal(g.plan, null);
  assert.equal(g.discarded, 1);
  assert.equal(g.calls, 1);
  g.dispose();
});
test("weapon or observation change invalidates an in-flight tactical choice", async () => {
  let finish!: (r: DecisionResponse) => void;
  const g = new Game(() => new Promise((r) => (finish = r)));
  const pending = g.think();
  g.ai.weapon = "laser";
  finish(response("hold"));
  await pending;
  assert.equal(g.plan, null);
  assert.equal(g.discarded, 1);
  g.dispose();
});
test("reflex never moves the tank into a wall in a narrow corridor", () => {
  const g = new Game(noNetwork);
  g.grid = grid();
  for (let x = 1; x < COLS - 1; x++) {
    g.grid[3][x] = 1;
    g.grid[5][x] = 1;
  }
  g.ai = { ...g.ai, x: 240, y: 216 };
  g.player = { ...g.player, x: 700, y: 216 };
  g.bullets = [
    { x: 120, y: 216, vx: 220, vy: 0, owner: "player", age: 1, bounces: 0 },
  ];
  g.running = true;
  g.pending = true;
  g.nextDirector = Infinity;
  for (let i = 0; i < 40; i++) {
    g.update(0.016);
    assert.equal(blocked(g.grid, g.ai.x, g.ai.y, 15), false);
  }
  g.dispose();
});
test("recent hidden-target memory freezes position and expires without reading the player", () => {
  const g = new Game(noNetwork);
  g.observed = observation(300, 240, 80, 0);
  g.enemyVisible = false;
  g.time = 0.3;
  g.player.x = 800;
  const remembered = g.shootingObservation();
  assert.ok(remembered);
  assert.equal(remembered.x, 300);
  assert.deepEqual(remembered.velocity, { x: 0, y: 0 });
  g.time = 0.76;
  assert.equal(g.shootingObservation(), null);
  g.dispose();
});
test("danger events cannot bypass failure backoff", async () => {
  let count = 0,
    now = 0;
  const g = new Game(
    async () => {
      count++;
      throw Error("offline");
    },
    () => now,
  );
  await g.think();
  g.nextThink = 0;
  now = 500;
  g.time = 0.5;
  await g.think();
  assert.equal(count, 1);
  now = 2100;
  g.time = 2.1;
  await g.think();
  assert.equal(count, 2);
  g.dispose();
});
