import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, type DecisionTransport } from "../web/src/game";
import { COLS, ROWS } from "../web/src/navigation";
import { buildApp } from "../server/app";
import { MOVES } from "../shared/controls";
import type { DecisionRequest, DecisionResponse } from "../shared/types";

const responseFor = (
  body: DecisionRequest,
  kind = "right:hold",
): DecisionResponse => {
  const candidate =
    body.candidates.find((item) => item.kind === kind) ?? body.candidates[0];
  if (!candidate) throw Error("fixture received no candidates");
  return {
    choice: candidate.id,
    confidence: 0.5,
    probabilities: Object.fromEntries(
      body.candidates.map((item) => [item.id, item.id === candidate.id ? 1 : 0]),
    ),
    latencyMs: 10,
    model: "fixture",
    source: "jev",
    round: body.round,
    revision: body.revision,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
};

function setup(
  transport: DecisionTransport = async (body) => responseFor(body),
) {
  let now = 0;
  const g = new Game(transport, () => now);
  g.reset("direct");
  g.running = true;
  g.grid = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) =>
      x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? 1 : 0,
    ),
  );
  Object.assign(g.ai, { x: 300, y: 300, turret: 0 });
  Object.assign(g.player, { x: 150, y: 150 });
  g.nextDirector = Infinity;
  return { g, tick: (ms: number) => (now = ms) };
}

test("direct control asks one Choice for a complete candidate", async () => {
  let request: any;
  const app = buildApp({
    evaluate: async (payload) => {
      request = payload;
      return {
        answers: {
          control: {
            choice: "c1",
            confidence: 0.8,
            probabilities: { c0: 0.25, c1: 0.75, invented: 1 },
          },
        },
        usage: { input_tokens: 10, output_tokens: 2 },
        model: "fixture",
      };
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/decision",
    payload: {
      role: "controls",
      round: 1,
      revision: 0,
      state: { controlCandidates: { rows: { c0: [], c1: [] } } },
      candidates: [
        { id: "c0", description: "first", distance: 0, risk: 0, fire: false },
        { id: "c1", description: "second", distance: 1, risk: 0, fire: true },
      ],
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().choice, "c1");
  assert.deepEqual(response.json().probabilities, { c0: 0.25, c1: 0.75 });
  assert.deepEqual(Object.keys(request.questions), ["control"]);
  assert.deepEqual(Object.keys(request.questions.control.criteria), [
    "c0",
    "c1",
  ]);
  assert.equal(request.state.availablePlans, undefined);
  await app.close();
});

test("server rejects a control choice outside the offered batch", async () => {
  const app = buildApp({
    evaluate: async () => ({
      answers: { control: { choice: "invented", confidence: 0.9 } },
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/decision",
    payload: {
      role: "controls",
      round: 1,
      revision: 0,
      state: {},
      candidates: [
        { id: "c0", description: "only", distance: 0, risk: 0, fire: false },
      ],
    },
  });
  assert.equal(response.statusCode, 502);
  await app.close();
});

test("candidate selection executes bundled movement, aim and trigger", async () => {
  const { g } = setup();
  await g.thinkDirect();
  g.nextThink = Infinity;
  for (let i = 0; i < 10; i++) g.update(0.02);
  assert.ok(g.ai.x > 300);
  assert.equal(g.ai.turret, 0);
  assert.equal(g.bullets.length, 0);
  g.directInput!.fire = true;
  g.update(0.02);
  assert.equal(g.bullets.length, 1);
});

test("pending request keeps the world running and stale response is ignored", async () => {
  let resolve!: (response: DecisionResponse) => void;
  let sent!: DecisionRequest;
  const { g, tick } = setup(
    (body) =>
      new Promise((done) => {
        sent = body;
        resolve = done;
      }),
  );
  g.directInput = { move: "right", aim: 0, fire: false, at: 0, wall: 0 };
  const pending = g.thinkDirect();
  g.keys.add("KeyD");
  g.update(0.02);
  assert.ok(g.time > 0);
  assert.ok(g.ai.x > 300);
  assert.ok(g.player.x > 150);
  tick(1900);
  const x = g.ai.x;
  g.update(0.02);
  assert.equal(g.ai.x, x);
  resolve(responseFor(sent));
  await pending;
  assert.equal(g.discarded, 1);
  assert.equal(g.directTrace[0].status, "stale");
});

test("failure preserves unexpired input and cannot overlap requests", async () => {
  let count = 0;
  let reject!: (error: Error) => void;
  const { g, tick } = setup(() => {
    count++;
    return new Promise((_, fail) => (reject = fail));
  });
  g.directInput = { move: "right", aim: 0, fire: false, at: 0, wall: 0 };
  const pending = g.thinkDirect();
  await g.thinkDirect();
  assert.equal(count, 1);
  reject(Error("fixture timeout"));
  await pending;
  g.executeDirect(0.02);
  assert.ok(g.ai.x > 300);
  tick(400);
  await g.thinkDirect();
  assert.equal(count, 1);
});

test("pause invalidates an in-flight control candidate", async () => {
  let resolve!: (response: DecisionResponse) => void;
  let sent!: DecisionRequest;
  const { g } = setup(
    (body) =>
      new Promise((done) => {
        sent = body;
        resolve = done;
      }),
  );
  const pending = g.thinkDirect();
  g.toggle();
  resolve(responseFor(sent));
  await pending;
  assert.equal(g.directInput, null);
  assert.equal(g.running, false);
});

test("observation is compact and hides raw map and player input", () => {
  const { g } = setup();
  g.velocity = { x: 80, y: 0 };
  g.bullets.push({
    x: 1,
    y: 2,
    vx: 3,
    vy: 4,
    owner: "player",
    age: 0,
    bounces: 0,
  });
  const state = g.controlObservation();
  assert.equal(state.enemy.x, 150);
  assert.equal(state.enemy.velocity.x, 80);
  g.bullets[0].x = 99;
  assert.equal(state.bullets[0][0], 1);
  assert.ok(!("arena" in state));
  assert.ok(!("keys" in state));
  assert.ok(!("mouse" in state));
});

test("candidates bundle movement, navigation, danger and fire", () => {
  const { g } = setup();
  Object.assign(g.ai, { x: 312, y: 312 });
  Object.assign(g.player, { x: 430, y: 312 });
  g.grid[6][5] = 1;
  const candidates = g.directControlCandidates();
  assert.ok(candidates.length > Object.keys(MOVES).length);
  assert.ok(candidates.length <= 128);
  assert.equal(
    new Set(candidates.map((item) => item.id)).size,
    candidates.length,
  );
  const left = candidates.find((item) => item.kind === "left:hold")!;
  const right = candidates.find((item) => item.kind === "right:hold")!;
  assert.equal(left.motion.blocked, true);
  assert.ok(left.motion.movedPx < right.motion.movedPx);
  assert.equal(left.motion.blockedAxes.includes("x"), true);
  assert.ok(candidates.some((item) => item.fire && item.shot?.hit));
  const state = g.controlObservation(candidates);
  assert.equal(
    Object.keys(state.controlCandidates.rows).length,
    candidates.length,
  );
  assert.equal(state.navigationToEnemy.reachable, true);
  const requestBytes = JSON.stringify({
    role: "controls",
    round: 1,
    revision: 0,
    state,
    candidates: candidates.map((item) => ({
      id: item.id,
      description: item.kind,
      distance: item.motion.movedPx,
      risk: item.danger,
      fire: item.fire,
      kind: item.kind,
    })),
  }).length;
  assert.ok(requestBytes < 32_000);
});

test("Jev receives ricochet trajectories and explicit self-fire impacts", () => {
  const { g } = setup();
  Object.assign(g.ai, { x: 300, y: 300 });
  g.bullets = [
    {
      x: 220,
      y: 300,
      vx: 220,
      vy: 0,
      owner: "ai",
      age: 0.3,
      bounces: 0,
    },
  ];
  const candidates = g.directControlCandidates();
  const stop = candidates.find((item) => item.kind === "stop:hold")!;
  assert.ok(stop.selfProjectileHitIn !== null);
  const state = g.controlObservation(candidates);
  assert.equal(state.bulletTrajectories.rows[0][1], "ai");
  assert.equal(state.bulletTrajectories.rows[0][2], 0);
  assert.ok((state.bulletTrajectories.rows[0][3] as number[][]).length >= 6);
  assert.match(state.bulletTrajectories.rule, /including their owner/);
  const columns = state.controlCandidates.columns.split(",");
  const selfHitIndex = columns.indexOf("self_projectile_hit_in_s");
  assert.ok(selfHitIndex >= 0);
  assert.ok(state.controlCandidates.rows[stop.id][selfHitIndex] !== null);
});

test("movement probabilities aggregate Jev's complete control candidates", () => {
  const { g } = setup();
  const candidates = g.directControlCandidates();
  const left = candidates.find((item) => item.move === "left")!;
  const right = candidates.filter((item) => item.move === "right").slice(0, 2);
  assert.equal(right.length, 2);
  g.directCandidates = candidates;
  g.controlProbabilities = {
    [left.id]: 0.2,
    [right[0].id]: 0.3,
    [right[1].id]: 0.5,
  };
  assert.deepEqual(g.movementProbabilities(), { left: 0.2, right: 0.8 });
});

test("current and completed controls report collision outcome", async () => {
  const { g } = setup(async (body) => responseFor(body, "left:hold"));
  Object.assign(g.ai, { x: 312, y: 312 });
  g.grid[6][5] = 1;
  await g.thinkDirect();
  g.nextThink = Infinity;
  for (let i = 0; i < 12; i++) g.update(0.025);
  const active = g.controlObservation();
  assert.equal(active.currentControl?.move, "left");
  assert.ok((active.currentControl?.blockedMs || 0) > 100);
  assert.equal(active.currentControl?.blockedAxes.includes("x"), true);
  g.finishDirectAction();
  const completed = g.controlObservation();
  assert.equal(completed.lastControlOutcome?.move, "left");
  assert.ok((completed.lastControlOutcome?.blockedMs || 0) > 100);
});
