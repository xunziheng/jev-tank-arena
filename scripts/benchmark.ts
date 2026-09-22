/** Offline deterministic scenario benchmark. This is NOT a Jev win-rate evaluation. */
import { performance } from "node:perf_hooks";
import { Game } from "../web/src/game";
import { COLS, ROWS } from "../web/src/navigation";
import { findShot, forecastHazards, assessMotion } from "../web/src/combat";
const map = () =>
  Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) =>
      x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? 1 : 0,
    ),
  );
let baselineHits = 0,
  reflexHits = 0,
  total = 0,
  reflexes = 0;
for (let scenario = 0; scenario < 24; scenario++) {
  const angle = (scenario * Math.PI * 2) / 24;
  for (const enabled of [false, true]) {
    const g = new Game(async () => {
      throw Error("No network permitted in this benchmark");
    });
    g.grid = map();
    g.ai = { ...g.ai, x: 456, y: 312 };
    g.player = { ...g.player, x: 100, y: 100 };
    g.running = true;
    g.pending = true;
    g.nextDirector = Infinity;
    const offset = 130 + (scenario % 3) * 15;
    g.bullets = [
      {
        x: g.ai.x - Math.cos(angle) * offset,
        y: g.ai.y - Math.sin(angle) * offset,
        vx: Math.cos(angle) * 220,
        vy: Math.sin(angle) * 220,
        owner: "player",
        age: 1,
        bounces: 0,
      },
    ];
    if (!enabled) g.updateReflex = () => {};
    for (let frame = 0; frame < 90; frame++) g.update(1 / 60);
    if (enabled) {
      reflexHits += 3 - g.ai.hp;
      reflexes += g.reflexCount;
    } else baselineHits += 3 - g.ai.hp;
    g.dispose();
  }
  total++;
}
const durations: number[] = [];
for (let i = 0; i < 80; i++) {
  const grid = map(),
    shooter = { x: 130, y: 110 },
    target = { x: 300, y: 110, velocity: { x: 0, y: 0 }, seenAt: 0 };
  const start = performance.now();
  findShot(grid, shooter, target, "normal", "bank");
  const h = forecastHazards(
    grid,
    [{ x: 70, y: 110, vx: -220, vy: 0, owner: "player", age: 1, bounces: 0 }],
    [],
    [],
  );
  for (let d = 0; d < 8; d++)
    assessMotion(
      grid,
      shooter,
      [
        {
          x: 130 + Math.cos((d * Math.PI) / 4) * 100,
          y: 110 + Math.sin((d * Math.PI) / 4) * 100,
        },
      ],
      h,
    );
  durations.push(performance.now() - start);
}
durations.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      kind: "offline synthetic incoming-projectile scenarios; NOT Jev matches",
      scenarios: total,
      baselineDamage: baselineHits,
      reflexDamage: reflexHits,
      reflexInterventions: reflexes,
      planningSampleMs: {
        median: Number(durations[40].toFixed(2)),
        p95: Number(durations[76].toFixed(2)),
      },
    },
    null,
    2,
  ),
);
if (reflexHits >= baselineHits) process.exitCode = 1;
