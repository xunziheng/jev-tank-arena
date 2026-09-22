/** Explicitly invoked bounded live smoke test: four decisions, no listening server. */
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { buildApp } from "../server/app";
import { Game } from "../web/src/game";
import { COLS, ROWS } from "../web/src/navigation";
import { performance } from "node:perf_hooks";
const env = parse(readFileSync(process.env.TYPESAFE_ENV_FILE || ".env"));
if (!env.TYPESAFE_API_KEY) {
  console.log("No Jev key configured; live verification skipped.");
  process.exit(2);
}
const app = buildApp({
  apiKey: env.TYPESAFE_API_KEY,
  model: env.TYPESAFE_MODEL,
});
const results = [];
try {
  for (const scenario of [
    "clear_shot",
    "incoming_bullet",
    "laser_warning",
    "weapon_contention",
  ]) {
    const g = new Game(async () => {
      throw Error("transport unused");
    });
    g.grid = Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: COLS }, (_, x) =>
        x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? 1 : 0,
      ),
    );
    g.ai = { ...g.ai, x: 240, y: 240 };
    g.player = { ...g.player, x: 430, y: 240 };
    g.time = 1;
    g.observeEnemy(0.016);
    if (scenario === "incoming_bullet")
      g.bullets = [
        {
          x: 345,
          y: 240,
          vx: -220,
          vy: 0,
          age: 1,
          bounces: 0,
          owner: "player",
        },
      ];
    if (scenario === "laser_warning")
      g.beams = [
        {
          from: { x: 400, y: 240 },
          to: { x: 60, y: 240 },
          age: 0.2,
          owner: "player",
          fired: false,
        },
      ];
    if (scenario === "weapon_contention")
      g.pickups = [{ x: 312, y: 312, id: 1, weapon: "laser", expires: 30 }];
    const plans = g.plans();
    const started = performance.now();
    const res = await app.inject({
      method: "POST",
      url: "/api/decision",
      payload: {
        role: "tank",
        round: 1,
        revision: 0,
        state: {
          self: { x: g.ai.x, y: g.ai.y, hp: 3, weapon: "normal" },
          enemyVisible: true,
          enemyLastSeen: g.observed,
          incomingDanger: g.risk(g.ai),
          controller:
            "Local controller executes safe aiming and emergency dodge; you choose the tactical plan.",
        },
        candidates: plans.map((p) => ({
          id: p.id,
          description: p.description,
          distance: p.path.length * 48,
          risk: p.risk,
          fire: p.fire,
        })),
      },
    });
    const data = res.json(),
      selected = plans.find((p) => p.id === data.choice);
    results.push({
      scenario,
      status: res.statusCode,
      choice: selected?.id ?? null,
      selectedRisk: selected?.risk ?? null,
      confidence: data.confidence ?? null,
      roundTripMs: Math.round(performance.now() - started),
      model: data.model ?? null,
      usage: data.usage ?? null,
    });
    g.dispose();
    await new Promise((r) => setTimeout(r, 250));
  }
} finally {
  await app.close();
}
console.log(
  JSON.stringify(
    {
      kind: "LIVE Jev API, synthetic arena snapshots, not a match win-rate benchmark",
      results,
    },
    null,
    2,
  ),
);
if (results.some((r) => r.status !== 200)) process.exitCode = 1;
