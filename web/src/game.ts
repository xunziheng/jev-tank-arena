import { MOVES } from "../../shared/controls";
import {
  advanceProjectile,
  findShot,
  traceShot,
  interceptTime,
  predictedPosition,
  forecastHazards,
  assessMotion,
  decisionInterval,
  TANK_SPEED,
  PREDICTION_STEP,
  type Observation,
  type Hazard,
  type Shot,
} from "./combat";
import {
  WEAPONS,
  type Point,
  type Weapon,
  type Mode,
  type Plan,
  type DecisionRequest,
  type DecisionResponse,
} from "../../shared/types";
import {
  astar,
  blocked,
  cell,
  center,
  COLS,
  ROWS,
  TILE,
  distance,
  makeArena,
  rayEnd,
  segmentDistance,
  visible,
  type Grid,
} from "./navigation";
export type Tank = Point & {
  id: "player" | "ai";
  angle: number;
  turret: number;
  hp: number;
  weapon: Weapon;
  ammo: number;
  cooldown: number;
};
export type Bullet = Point & {
  vx: number;
  vy: number;
  owner: string;
  age: number;
  bounces: number;
};
export type Pickup = Point & { id: number; weapon: Weapon; expires: number };
export type Mine = Point & { age: number; owner: string };
export type Beam = {
  from: Point;
  to: Point;
  age: number;
  owner: string;
  fired: boolean;
};
export type Log = {
  id: number;
  time: number;
  role: string;
  text: string;
  source: string;
};
export type Snapshot = {
  running: boolean;
  mode: Mode;
  round: number;
  score: number[];
  hp: number[];
  weapons: Weapon[];
  ammo: number[];
  time: number;
  plan: string;
  director: string;
  pending: boolean;
  latency: number;
  confidence: number | null;
  calls: number;
  tokens: number;
  error: string;
  logs: Log[];
  winner: string;
  roundOver: boolean;
  cadence: number;
  reflex: string;
  reflexCount: number;
  discarded: number;
  shotType: string;
  decisionAge: number | null;
  e2eLatency: number;
  appliedInterval: number | null;
  controls: string;
  controlAge: number | null;
  candidateCount: number;
};
export type DecisionTransport = (
  body: DecisionRequest,
  signal: AbortSignal,
) => Promise<DecisionResponse>;
type DirectControlCandidate = {
  id: string;
  kind: string;
  move: string;
  aim: number;
  fire: boolean;
  durationMs: number;
  motion: ReturnType<Game["previewDirectMove"]>;
  routeRemainingCells: number | null;
  routeProgressCells: number | null;
  danger: number;
  hitIn: number | null;
  selfProjectileHitIn: number | null;
  shot: null | {
    hit: boolean;
    bounces: number | null;
    hitIn: number | null;
    mine: boolean;
  };
};
export class Game {
  grid: Grid;
  player: Tank;
  ai: Tank;
  bullets: Bullet[] = [];
  pickups: Pickup[] = [];
  mines: Mine[] = [];
  beams: Beam[] = [];
  particles: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    color: string;
  }[] = [];
  keys = new Set<string>();
  mouse = { x: 250, y: 100, down: false };
  mode: Mode = "jev";
  running = false;
  time = 0;
  round = 1;
  score = [0, 0];
  winner = "";
  roundOver = false;
  roundTimer = 0;
  showPaths = true;
  plan: Plan | null = null;
  planAge = 0;
  lastSeen: Point | null = null;
  lastSeenAt = -100;
  revision = 0;
  observed: Observation | null = null;
  enemyVisible = false;
  hazards: Hazard[] = [];
  nextCombat = 0;
  nextRoute = 0;
  reflexPath: Point[] | null = null;
  reflexUntil = 0;
  reflexCount = 0;
  reflexLabel = "MONITORING TRAJECTORIES";
  shotType = "AWAITING FIRE AUTHORIZATION";
  discarded = 0;
  lastAppliedAt = -1;
  appliedInterval: number | null = null;
  e2eLatency = 0;
  lastAttemptAt = -Infinity;
  nextAttemptAt = 0;
  failedUntil = 0;
  nextShotCheck = 0;
  currentShot: Shot | null = null;
  logs: Log[] = [];
  latency = 0;
  confidence: number | null = null;
  calls = 0;
  tokens = 0;
  error = "";
  director = "WAITING FOR BATTLE";
  nextThink = 0;
  nextDirector = 2;
  pending = false;
  directorPending = false;
  epoch = 0;
  nextId = 1;
  controllers = new Set<AbortController>();
  disposed = false;
  directInput: {
    move: string;
    aim: number;
    fire: boolean;
    at: number;
    wall: number;
  } | null = null;
  velocity = { x: 0, y: 0 };
  selfVelocity = { x: 0, y: 0 };
  directAction: {
    move: string;
    startedAt: number;
    start: Point;
    end: Point;
    movedPx: number;
    blockedMs: number;
    blockedXMs: number;
    blockedYMs: number;
  } | null = null;
  lastDirectOutcome: {
    move: string;
    durationMs: number;
    start: Point;
    end: Point;
    displacementPx: number;
    pathLengthPx: number;
    blockedMs: number;
    blockedAxes: string[];
  } | null = null;
  directCandidates: DirectControlCandidate[] = [];
  selectedControlId = "";
  controlProbabilities: Record<string, number> = {};
  directTrace: {
    at: number;
    state: Record<string, unknown>;
    result?: unknown;
    applied?: number;
    status: string;
  }[] = [];
  directStatus() {
    const c = this.directInput;
    return c && this.clock() - c.wall < 1800 && this.time - c.at < 1.8;
  }

  constructor(
    public transport: DecisionTransport,
    public clock: () => number = () => performance.now(),
    public random: () => number = Math.random,
  ) {
    this.grid = makeArena(this.random);
    [this.player, this.ai] = this.spawnTanks();
  }
  newTank(id: "player" | "ai", spawn: Point, angle: number): Tank {
    return {
      ...center(spawn),
      id,
      angle,
      turret: angle,
      hp: 3,
      weapon: "normal",
      ammo: 0,
      cooldown: 0,
    };
  }
  spawnTanks(): [Tank, Tank] {
    const floors: Point[] = [];
    for (let y = 1; y < ROWS - 1; y++)
      for (let x = 1; x < COLS - 1; x++)
        if (this.grid[y][x] === 0) floors.push({ x, y });
    const playerCell = floors[Math.floor(this.random() * floors.length)];
    const distant = floors.filter((candidate) => {
      const route = astar(this.grid, playerCell, candidate);
      return (
        route.length >= 8 &&
        distance(center(playerCell), center(candidate)) >= TILE * 6
      );
    });
    const pool = distant.length
      ? distant
      : floors
          .filter((candidate) => astar(this.grid, playerCell, candidate).length)
          .sort(
            (a, b) =>
              distance(center(playerCell), center(b)) -
              distance(center(playerCell), center(a)),
          )
          .slice(0, Math.max(1, Math.ceil(floors.length / 4)));
    const aiCell = pool[Math.floor(this.random() * pool.length)];
    const playerPoint = center(playerCell),
      aiPoint = center(aiCell);
    const playerAngle = Math.atan2(
      aiPoint.y - playerPoint.y,
      aiPoint.x - playerPoint.x,
    );
    const aiAngle = Math.atan2(
      playerPoint.y - aiPoint.y,
      playerPoint.x - aiPoint.x,
    );
    return [
      this.newTank("player", playerCell, playerAngle),
      this.newTank("ai", aiCell, aiAngle),
    ];
  }
  log(
    role: string,
    text: string,
    source = this.mode !== "practice" ? "JEV" : "LOCAL",
  ) {
    this.logs = [
      { id: this.nextId++, time: this.time, role, text, source },
      ...this.logs,
    ].slice(0, 30);
  }
  invalidate() {
    this.epoch++;
    this.finishDirectAction();
    this.directInput = null;
    this.selfVelocity = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
    this.pending = false;
    this.directorPending = false;
    this.keys.clear();
    this.mouse.down = false;
  }
  toggle() {
    if (this.winner) return;
    this.running = !this.running;
    this.invalidate();
    this.nextThink = this.time;
    this.nextDirector = Math.max(this.time + 1, this.nextDirector);
  }
  reset(mode: Mode = this.mode) {
    this.invalidate();
    this.mode = mode;
    this.running = false;
    this.grid = makeArena(this.random);
    this.round = 1;
    this.time = 0;
    this.score = [0, 0];
    this.winner = "";
    this.logs = [];
    this.error = "";
    this.directTrace = [];
    this.calls = 0;
    this.tokens = 0;
    this.latency = 0;
    this.confidence = null;
    this.reflexCount = 0;
    this.discarded = 0;
    this.newRound();
  }
  newRound() {
    this.invalidate();
    this.lastDirectOutcome = null;
    this.directCandidates = [];
    this.selectedControlId = "";
    this.controlProbabilities = {};
    this.revision++;
    [this.player, this.ai] = this.spawnTanks();
    this.bullets = [];
    this.pickups = [];
    this.mines = [];
    this.beams = [];
    this.plan = null;
    this.roundOver = false;
    this.lastSeen = null;
    this.lastSeenAt = -100;
    this.observed = null;
    this.enemyVisible = false;
    this.hazards = [];
    this.reflexPath = null;
    this.reflexUntil = 0;
    this.nextCombat = this.time;
    this.nextRoute = this.time;
    this.nextShotCheck = this.time;
    this.currentShot = null;
    this.lastAppliedAt = -1;
    this.appliedInterval = null;
    this.failedUntil = 0;
    this.nextAttemptAt = 0;
    this.lastAttemptAt = -Infinity;
    this.nextThink = this.time;
    this.nextDirector = this.time + 1;
    this.director = "AWAITING DROP WINDOW";
  }
  dispose() {
    this.disposed = true;
    this.invalidate();
  }
  snapshot(): Snapshot {
    return {
      running: this.running,
      mode: this.mode,
      round: this.round,
      score: [...this.score],
      hp: [this.player.hp, this.ai.hp],
      weapons: [this.player.weapon, this.ai.weapon],
      ammo: [this.player.ammo, this.ai.ammo],
      time: this.time,
      plan:
        this.mode === "direct"
          ? "JEV DIRECT CONTROL"
          : this.plan?.label || "WAITING FOR DECISION",
      director: this.director,
      pending: this.pending,
      latency: this.latency,
      confidence: this.confidence,
      calls: this.calls,
      tokens: this.tokens,
      error: this.error,
      logs: this.logs,
      winner: this.winner,
      roundOver: this.roundOver,
      cadence: this.mode === "direct" ? 250 : Math.round(this.cadence() * 1000),
      reflex:
        this.mode === "direct"
          ? "ASSISTS OFF"
          : this.reflexPath
            ? "LOCAL EMERGENCY DODGE"
            : "MONITORING TRAJECTORIES",
      reflexCount: this.reflexCount,
      discarded: this.discarded,
      shotType:
        this.mode === "direct"
          ? this.directStatus()
            ? "JEV INPUT ACTIVE"
            : "INPUT EXPIRED / WAITING"
          : this.shotType,
      controls: this.directInput
        ? `${this.directStatus() ? this.directInput.move : "stop"} · ${(((this.ai.turret * 180) / Math.PI + 360) % 360).toFixed(1)}° · ${this.directStatus() && this.directInput.fire ? "FIRE" : "HOLD"}`
        : "stop · WAITING FOR JEV",
      controlAge: this.directInput
        ? Math.round(this.clock() - this.directInput.wall)
        : null,
      candidateCount: this.directCandidates.length,
      decisionAge:
        this.lastAppliedAt < 0
          ? null
          : Math.round((this.time - this.lastAppliedAt) * 1000),
      e2eLatency: this.e2eLatency,
      appliedInterval: this.appliedInterval,
    };
  }
  move(tank: Tank, dx: number, dy: number, dt: number) {
    const mag = Math.hypot(dx, dy);
    if (!mag) return;
    dx = (dx / mag) * 116 * dt;
    dy = (dy / mag) * 116 * dt;
    const other = tank.id === "player" ? this.ai : this.player;
    if (
      !blocked(this.grid, tank.x + dx, tank.y, 15) &&
      distance({ x: tank.x + dx, y: tank.y }, other) >= 30
    )
      tank.x += dx;
    if (
      !blocked(this.grid, tank.x, tank.y + dy, 15) &&
      distance({ x: tank.x, y: tank.y + dy }, other) >= 30
    )
      tank.y += dy;
    tank.angle = Math.atan2(dy, dx);
  }
  shoot(t: Tank) {
    if (t.cooldown > 0 || t.hp <= 0) return;
    const x = t.x + Math.cos(t.turret) * 23,
      y = t.y + Math.sin(t.turret) * 23;
    if (blocked(this.grid, x, y, 4)) return;
    if (t.weapon === "mine") {
      if (this.mines.some((m) => distance(m, t) < 28)) return;
      this.mines.push({ x: t.x, y: t.y, age: 0, owner: t.id });
      t.cooldown = 0.8;
    } else if (t.weapon === "laser") {
      this.beams.push({
        from: { x, y },
        to: rayEnd(this.grid, { x, y }, t.turret),
        age: 0,
        owner: t.id,
        fired: false,
      });
      t.cooldown = 1.8;
    } else {
      const spread = t.weapon === "machine" ? (Math.random() - 0.5) * 0.07 : 0,
        a = t.turret + spread;
      this.bullets.push({
        x,
        y,
        vx: Math.cos(a) * 220,
        vy: Math.sin(a) * 220,
        owner: t.id,
        age: 0,
        bounces: 0,
      });
      t.cooldown = t.weapon === "machine" ? 0.16 : 0.65;
    }
    if (t.weapon !== "normal" && --t.ammo <= 0) {
      t.weapon = "normal";
      t.ammo = 0;
    }
  }
  hit(t: Tank, damage: number) {
    if (t.hp <= 0) return;
    t.hp = Math.max(0, t.hp - damage);
    this.burst(t, t.id === "player" ? "#96e4c3" : "#ffad7a");
    this.nextThink = Math.min(this.nextThink, this.time + 0.25);
  }
  burst(p: Point, color: string) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2,
        s = 30 + Math.random() * 130;
      this.particles.push({
        ...p,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.3 + Math.random() * 0.5,
        color,
      });
    }
  }
  update(dt: number) {
    if (!this.running || this.winner) return;
    dt = Math.min(dt, 0.035);
    this.time += dt;
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return p.life > 0;
    });
    if (this.roundOver) {
      this.roundTimer -= dt;
      if (this.roundTimer <= 0) {
        this.round++;
        this.newRound();
      }
      return;
    }
    for (const t of [this.player, this.ai])
      t.cooldown = Math.max(0, t.cooldown - dt);
    const dx =
      Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    const dy =
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")) -
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp"));
    const before = { x: this.player.x, y: this.player.y };
    this.move(this.player, dx, dy, dt);
    this.velocity = {
      x: (this.player.x - before.x) / dt,
      y: (this.player.y - before.y) / dt,
    };
    this.player.turret = Math.atan2(
      this.mouse.y - this.player.y,
      this.mouse.x - this.player.x,
    );
    if (this.mouse.down || this.keys.has("Space")) this.shoot(this.player);
    if (this.mode === "direct") this.executeDirect(dt);
    else {
      this.observeEnemy(dt);
      this.executeCombat(dt);
    }
    this.stepProjectiles(dt);
    for (const t of [this.player, this.ai])
      for (const p of this.pickups) {
        if (p.expires > this.time && distance(t, p) < 26) {
          t.weapon = p.weapon;
          t.ammo = p.weapon === "machine" ? 24 : p.weapon === "laser" ? 4 : 3;
          p.expires = 0;
          this.revision++;
          this.burst(p, WEAPONS[p.weapon].color);
          this.log(
            t.id === "player" ? "PLAYER" : "OPPONENT",
            `PICKED UP ${WEAPONS[p.weapon].name}`,
            "GAME",
          );
          this.nextThink = Math.min(this.nextThink, this.time + 0.2);
        }
      }
    this.pickups = this.pickups.filter((p) => p.expires > this.time);
    if (this.player.hp <= 0 || this.ai.hp <= 0) {
      this.roundOver = true;
      this.roundTimer = 2;
      this.invalidate();
      this.plan = null;
      if (this.player.hp > 0) this.score[0]++;
      else if (this.ai.hp > 0) this.score[1]++;
      this.log(
        "ROUND",
        this.player.hp === 0 && this.ai.hp === 0
          ? "DOUBLE KNOCKOUT"
          : this.player.hp > 0
            ? "PLAYER SCORES"
            : "OPPONENT SCORES",
        "GAME",
      );
      if (Math.max(...this.score) >= 5) {
        this.winner = this.score[0] >= 5 ? "YOU WIN" : "OPPONENT WINS";
        this.running = false;
      }
      return;
    }
    if (this.time >= this.nextThink && !this.pending) {
      if (this.mode === "direct") void this.thinkDirect();
      else void this.think();
    }
    if (this.time >= this.nextDirector && !this.directorPending)
      void this.direct();
  }
  stepProjectiles(dt: number) {
    this.bullets = this.bullets.filter((b) =>
      advanceProjectile(this.grid, b, dt, (p) => {
        for (const t of [this.player, this.ai]) {
          if (!(p.owner === t.id && p.age < 0.18) && distance(p, t) < 17) {
            this.hit(t, 1);
            return false;
          }
        }
        return true;
      }),
    );
    this.beams = this.beams.filter((b) => {
      b.age += dt;
      if (b.age >= 0.65 && !b.fired) {
        b.fired = true;
        for (const t of [this.player, this.ai])
          if (t.id !== b.owner && segmentDistance(t, b.from, b.to) < 18)
            this.hit(t, 2);
      }
      return b.age < 0.9;
    });
    this.mines = this.mines.filter((m) => {
      m.age += dt;
      if (m.age > 25) return false;
      if (
        m.age > 1 &&
        [this.player, this.ai].some((t) => distance(t, m) < 27)
      ) {
        for (const t of [this.player, this.ai])
          if (distance(t, m) < 65 && visible(this.grid, m, t)) this.hit(t, 2);
        this.burst(m, "#ff8c78");
        return false;
      }
      return true;
    });
  }
  route(to: Point) {
    const cells = astar(this.grid, cell(this.ai), cell(to), (p) =>
      this.mines.some((m) => distance(center(p), m) < 44) ? 15 : 0,
    );
    const points = cells.map(center);
    if (points.length > 1) {
      const next = points[1],
        steps = Math.ceil(distance(this.ai, next) / 3);
      let clear = true;
      for (let i = 0; i <= steps; i++) {
        const t = i / (steps || 1);
        if (
          blocked(
            this.grid,
            this.ai.x + (next.x - this.ai.x) * t,
            this.ai.y + (next.y - this.ai.y) * t,
            15,
          )
        ) {
          clear = false;
          break;
        }
      }
      if (clear) points.shift();
    }
    return points;
  }
  shootingObservation(): Observation | null {
    if (!this.observed) return null;
    if (this.enemyVisible) return this.observed;
    // A short, explicitly uncertain memory can authorize a bank shot. Never sample hidden motion.
    if (this.time - this.observed.seenAt <= 0.75)
      return { ...this.observed, velocity: { x: 0, y: 0 } };
    return null;
  }
  refreshHazards() {
    this.hazards = forecastHazards(
      this.grid,
      this.bullets,
      this.mines,
      this.beams,
    );
  }
  risk(p: Point) {
    return assessMotion(this.grid, p, [], this.hazards).risk;
  }
  cadence() {
    return decisionInterval(
      this.enemyVisible,
      this.risk(this.ai) > 5,
      Boolean(
        this.plan?.pickupId ||
        (this.lastSeen && this.time - this.lastSeenAt < 5),
      ),
    );
  }
  observeEnemy(dt: number) {
    const sight = visible(this.grid, this.ai, this.player);
    const wasVisible = this.enemyVisible;
    if (sight) {
      let velocity = { x: 0, y: 0 };
      if (
        wasVisible &&
        this.observed &&
        dt > 0 &&
        this.time - this.observed.seenAt < 0.1
      ) {
        const vx = (this.player.x - this.observed.x) / dt,
          vy = (this.player.y - this.observed.y) / dt;
        const scale = Math.min(1, TANK_SPEED / (Math.hypot(vx, vy) || 1));
        velocity = { x: vx * scale, y: vy * scale };
      }
      this.observed = {
        x: this.player.x,
        y: this.player.y,
        velocity,
        seenAt: this.time,
      };
      this.lastSeen = { x: this.player.x, y: this.player.y };
      this.lastSeenAt = this.time;
    }
    this.enemyVisible = sight;
    if (sight !== wasVisible) {
      this.nextThink = Math.min(this.nextThink, this.time);
      this.nextShotCheck = this.time;
      this.currentShot = null;
    }
  }
  follow(path: Point[], dt: number) {
    while (path[0] && distance(this.ai, path[0]) < 3) path.shift();
    if (path[0]) {
      const p = path[0];
      this.move(
        this.ai,
        p.x - this.ai.x,
        p.y - this.ai.y,
        Math.min(dt, distance(this.ai, p) / TANK_SPEED),
      );
    }
  }
  executeCombat(dt: number) {
    if (this.plan) {
      this.planAge += dt;
      if (
        this.planAge > 1.8 ||
        (this.plan.pickupId &&
          !this.pickups.some((p) => p.id === this.plan!.pickupId))
      ) {
        this.plan = null;
        this.nextThink = Math.min(this.nextThink, this.time);
      }
    }
    if (this.plan && this.time >= this.nextRoute) {
      if (this.plan.followsEnemy && this.enemyVisible && this.observed)
        this.plan.target = { x: this.observed.x, y: this.observed.y };
      if (
        this.plan.id === "fire" ||
        this.plan.id === "bank" ||
        this.plan.id === "hold"
      )
        this.plan.path = [];
      else this.plan.path = this.route(this.plan.target);
      this.nextRoute = this.time + 0.15;
    }
    if (this.time >= this.nextCombat) {
      this.refreshHazards();
      this.updateReflex();
      this.nextCombat = this.time + 0.05;
    }
    const dodging = this.reflexPath && this.time < this.reflexUntil;
    if (dodging) this.follow(this.reflexPath!, dt);
    else {
      this.reflexPath = null;
      if (this.plan) this.follow(this.plan.path, dt);
    }
    // Observation is the only target input. Hidden players are never queried by the aiming controller.
    if (this.enemyVisible && this.observed && this.ai.weapon !== "mine") {
      const lead =
        this.ai.weapon === "laser"
          ? 0.65
          : Math.min(
              1.8,
              Math.max(
                0,
                interceptTime(this.ai, this.observed, this.observed.velocity) -
                  23 / 220,
              ),
            );
      const target = predictedPosition(
        this.grid,
        this.observed,
        this.observed.velocity,
        lead,
      );
      if (this.plan?.attack !== "bank")
        this.ai.turret = Math.atan2(target.y - this.ai.y, target.x - this.ai.x);
    }
    if (!this.plan?.fire) {
      this.shotType = "AWAITING FIRE AUTHORIZATION";
      return;
    }
    if (this.ai.weapon === "mine") {
      this.shotType = "CHECKING MINE ESCAPE";
      if (this.plan.attack === "mine" && !dodging && this.safeMineEscape())
        this.shoot(this.ai);
      return;
    }
    const remembered = this.shootingObservation();
    if (!remembered || (!this.enemyVisible && this.plan.attack !== "bank")) {
      this.currentShot = null;
      this.shotType = "TARGET LOST";
      return;
    }
    if (this.time >= this.nextShotCheck) {
      this.currentShot = findShot(
        this.grid,
        this.ai,
        remembered,
        this.ai.weapon,
        this.plan.attack === "bank"
          ? "bank"
          : this.plan.attack === "direct"
            ? "direct"
            : "auto",
        this.reflexPath || this.plan.path,
      );
      this.nextShotCheck = this.time + 0.075;
      if (this.currentShot) {
        this.ai.turret = this.currentShot.angle;
        this.shotType = this.currentShot.bounces
          ? this.enemyVisible
            ? "ONE-BOUNCE SHOT"
            : "MEMORY BANK SHOT"
          : "LEAD SHOT";
        if (this.ai.cooldown <= 0) this.shoot(this.ai);
      } else this.shotType = "NO SAFE SHOT";
    }
  }
  updateReflex() {
    const original = this.plan?.path || [];
    const current = assessMotion(
      this.grid,
      this.ai,
      original,
      this.hazards,
      this.enemyVisible ? this.observed || undefined : undefined,
    );
    if (current.hitIn === null || current.hitIn > 0.75) {
      if (this.time >= this.reflexUntil) this.reflexPath = null;
      return;
    }
    this.nextThink = Math.min(this.nextThink, this.time);
    const options: { path: Point[]; risk: number; clearance: number }[] = [];
    for (let i = -1; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const path =
        i < 0
          ? []
          : [
              {
                x: this.ai.x + Math.cos(a) * 110,
                y: this.ai.y + Math.sin(a) * 110,
              },
            ];
      const result = assessMotion(
        this.grid,
        this.ai,
        path,
        this.hazards,
        this.enemyVisible ? this.observed || undefined : undefined,
      );
      if (i >= 0 && distance(result.end, this.ai) < 8) continue;
      options.push({ path, risk: result.risk, clearance: result.clearance });
    }
    options.sort((a, b) => a.risk - b.risk || b.clearance - a.clearance);
    const best = options[0];
    if (!best || best.risk >= current.risk) return;
    if (!this.reflexPath || this.time >= this.reflexUntil) {
      this.reflexCount++;
      this.log("REFLEX", "DANGER PREDICTED · EMERGENCY DODGE", "LOCAL REFLEX");
    }
    this.reflexPath = best.path;
    this.reflexUntil = this.time + 0.18;
    this.nextRoute = this.reflexUntil;
  }
  safeMineEscape() {
    if (!this.plan || !this.plan.path.length || this.ai.cooldown > 0)
      return false;
    // A new mine arms after 1s: planned movement must exit its 65px blast radius by then.
    const escape = assessMotion(
      this.grid,
      this.ai,
      this.plan.path,
      this.hazards,
      this.enemyVisible ? this.observed || undefined : undefined,
    );
    return distance(escape.end, this.ai) > 75 && escape.risk === 0;
  }
  plans(): Plan[] {
    const known =
      this.lastSeen && this.time - this.lastSeenAt < 5 ? this.lastSeen : null;
    const aim = known
      ? Math.atan2(known.y - this.ai.y, known.x - this.ai.x)
      : this.ai.turret;
    this.refreshHazards();
    const direct =
      this.enemyVisible && this.observed
        ? findShot(this.grid, this.ai, this.observed, this.ai.weapon, "direct")
        : null;
    const remembered = this.shootingObservation();
    const bank = remembered
      ? findShot(this.grid, this.ai, remembered, this.ai.weapon, "bank")
      : null;
    const hasShot = Boolean(direct);
    const plans: Plan[] = [];
    const add = (
      id: string,
      label: string,
      description: string,
      target: Point,
      fire = false,
      pickupId?: number,
    ) => {
      const stationary = id === "hold" || id === "fire" || id === "bank";
      const path = stationary ? [] : this.route(target);
      if (!stationary && !path.length) return;
      const assessment = assessMotion(
        this.grid,
        this.ai,
        path,
        this.hazards,
        this.enemyVisible ? this.observed || undefined : undefined,
      );
      plans.push({
        id,
        label,
        description: `${description} First predicted impact: ${assessment.hitIn === null ? "none" : assessment.hitIn.toFixed(2) + "s"}.`,
        target,
        path,
        fire,
        aim,
        risk: assessment.risk,
        hitIn: assessment.hitIn,
        attack:
          id === "bank"
            ? "bank"
            : id === "fire"
              ? "direct"
              : this.ai.weapon === "mine"
                ? "mine"
                : "auto",
        followsEnemy: id === "chase",
        pickupId,
      });
    };
    add("hold", "HOLD AND OBSERVE", "Hold current position without firing.", this.ai);
    if (hasShot) {
      add(
        "fire",
        "AIM AND FIRE",
        this.ai.weapon === "mine"
          ? "Deploy a mine at current location."
          : "Fire at the last observed enemy position; line of sight is clear.",
        this.ai,
        true,
      );
    }
    if (bank)
      add(
        "bank",
        "BANK SHOT",
        this.enemyVisible
          ? "Fire a verified one-bounce shot at the currently observed enemy. Local controller continuously rechecks the shot."
          : "Fire a one-bounce shot at a frozen last-seen position less than 0.75s old. Enemy may have moved; this is uncertain, not wall vision.",
        this.ai,
        true,
      );
    if (known)
      add(
        "chase",
        "PURSUE TARGET",
        "Track the enemy while visible; pursue last observed position when hidden. Authorize locally verified safe shots during pursuit.",
        known,
        this.ai.weapon !== "mine",
      );
    for (const p of this.pickups)
      add(
        `pickup_${p.id}`,
        `CLAIM ${WEAPONS[p.weapon].name}`,
        `Collect ${p.weapon} weapon (${p.weapon === "machine" ? "rapid fire" : p.weapon === "laser" ? "telegraphed high damage beam" : "deployable mines"}).`,
        p,
        false,
        p.id,
      );
    const c = cell(this.ai);
    for (const [i, [dx, dy]] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].entries()) {
      const target = center({ x: c.x + dx, y: c.y + dy });
      if (blocked(this.grid, target.x, target.y, 15)) continue;
      add(
        `maneuver_${i}`,
        "STRAFE / DODGE",
        `Move to adjacent corridor. Enemy distance: ${known ? Math.round(distance(target, known)) : "unknown"}; incoming danger at destination: ${this.risk(target)}; can fire from destination: ${known ? visible(this.grid, target, known) : false}.`,
        target,
        this.ai.weapon !== "mine",
      );
    }
    let retreat: Point | null = null,
      best = -Infinity;
    for (let y = 1; y < ROWS - 1; y++)
      for (let x = 1; x < COLS - 1; x++) {
        const p = center({ x, y });
        if (this.grid[y][x]) continue;
        const d = distance(this.ai, p);
        if (d < 70 || d > 220) continue;
        const score =
          (known ? distance(p, known) : d) -
          (known && visible(this.grid, p, known) ? 100 : 0) -
          this.risk(p) * 5;
        if (score > best) {
          best = score;
          retreat = p;
        }
      }
    if (retreat)
      add(
        "retreat",
        "MOVE TO COVER",
        "Move toward cover away from last observed enemy; avoid incoming fire.",
        retreat,
        this.ai.weapon === "mine",
      );
    if (!known) {
      const points = [
        { x: 9, y: 6 },
        { x: 1, y: 1 },
        { x: COLS - 2, y: 1 },
        { x: 1, y: ROWS - 2 },
      ];
      const target = center(points[Math.floor(this.time / 9) % points.length]);
      add(
        "scout",
        "SEARCH ARENA",
        "Explore a search waypoint to find the opponent or equipment.",
        target,
      );
    }
    return plans;
  }
  async ask(body: DecisionRequest): Promise<DecisionResponse> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(
      () => controller.abort(),
      body.role !== "director" ? 3000 : 8500,
    );
    try {
      return await this.transport(body, controller.signal);
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }
  finishDirectAction() {
    const action = this.directAction;
    if (!action) return;
    const durationMs = Math.max(
      0,
      Math.round((this.time - action.startedAt) * 1000),
    );
    this.lastDirectOutcome = {
      move: action.move,
      durationMs,
      start: { ...action.start },
      end: { ...action.end },
      displacementPx: Math.round(distance(action.start, action.end)),
      pathLengthPx: Math.round(action.movedPx),
      blockedMs: Math.round(action.blockedMs),
      blockedAxes: [
        ...(action.blockedXMs > 40 ? ["x"] : []),
        ...(action.blockedYMs > 40 ? ["y"] : []),
      ],
    };
    this.directAction = null;
  }
  previewDirectMove(move: string, horizon = 1.25) {
    const [rawX, rawY] = MOVES[move];
    const magnitude = Math.hypot(rawX, rawY) || 1;
    const vx = (rawX / magnitude) * TANK_SPEED;
    const vy = (rawY / magnitude) * TANK_SPEED;
    let x = this.ai.x,
      y = this.ai.y,
      moved = 0,
      blockedX = false,
      blockedY = false;
    const step = 0.025;
    for (let elapsed = 0; elapsed < horizon; elapsed += step) {
      const dt = Math.min(step, horizon - elapsed);
      const oldX = x,
        oldY = y;
      if (
        !blocked(this.grid, x + vx * dt, y, 15) &&
        distance({ x: x + vx * dt, y }, this.player) >= 30
      )
        x += vx * dt;
      else if (rawX) blockedX = true;
      if (
        !blocked(this.grid, x, y + vy * dt, 15) &&
        distance({ x, y: y + vy * dt }, this.player) >= 30
      )
        y += vy * dt;
      else if (rawY) blockedY = true;
      moved += Math.hypot(x - oldX, y - oldY);
    }
    let clearance = 96;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      let d = 0;
      while (
        d < 96 &&
        !blocked(this.grid, x + dx * (d + 2), y + dy * (d + 2), 15)
      )
        d += 2;
      clearance = Math.min(clearance, d);
    }
    const beforeEnemy = distance(this.ai, this.player);
    const afterEnemy = distance({ x, y }, this.player);
    return {
      horizonMs: Math.round(horizon * 1000),
      start: { x: Math.round(this.ai.x), y: Math.round(this.ai.y) },
      end: { x: Math.round(x), y: Math.round(y) },
      endCell: cell({ x, y }),
      movedPx: Math.round(moved),
      blocked: Boolean((rawX && blockedX) || (rawY && blockedY)),
      blockedAxes: [...(blockedX ? ["x"] : []), ...(blockedY ? ["y"] : [])],
      minimumWallClearancePx: clearance,
      enemyDistanceAfterPx: Math.round(afterEnemy),
      enemyDistanceChangePx: Math.round(afterEnemy - beforeEnemy),
    };
  }
  routeGuidance() {
    const path = astar(this.grid, cell(this.ai), cell(this.player));
    if (!path.length) return { reachable: false, lengthCells: null, turns: [] };
    const turns = path.filter((p, i) => {
      if (i === 0 || i === path.length - 1) return true;
      const before = path[i - 1],
        after = path[i + 1];
      return (
        after.x - p.x !== p.x - before.x || after.y - p.y !== p.y - before.y
      );
    });
    return {
      reachable: true,
      lengthCells: path.length - 1,
      turns: turns.slice(0, 10),
      meaning:
        "Map navigation summary only; Jev still chooses every movement input.",
    };
  }
  executeDirect(dt: number) {
    const c = this.directInput;
    this.selfVelocity = { x: 0, y: 0 };
    if (!c || !this.directStatus()) {
      this.finishDirectAction();
      return;
    }
    const [dx, dy] = MOVES[c.move];
    const before = { x: this.ai.x, y: this.ai.y };
    this.move(this.ai, dx, dy, dt);
    const movedX = this.ai.x - before.x,
      movedY = this.ai.y - before.y;
    this.selfVelocity = { x: movedX / dt, y: movedY / dt };
    if (this.directAction) {
      this.directAction.end = { x: this.ai.x, y: this.ai.y };
      this.directAction.movedPx += Math.hypot(movedX, movedY);
      if (c.move !== "stop" && Math.hypot(movedX, movedY) < 0.05)
        this.directAction.blockedMs += dt * 1000;
      if (dx && Math.abs(movedX) < 0.05)
        this.directAction.blockedXMs += dt * 1000;
      if (dy && Math.abs(movedY) < 0.05)
        this.directAction.blockedYMs += dt * 1000;
      if (this.directAction.blockedMs >= 100)
        this.nextThink = Math.min(this.nextThink, this.time);
    }
    // Match player's immediate mouse-angle control; no automatic target tracking.
    this.ai.turret = c.aim;
    if (c.fire) this.shoot(this.ai);
  }
  directControlCandidates(): DirectControlCandidate[] {
    const target: Observation = {
      x: this.player.x,
      y: this.player.y,
      velocity: { ...this.velocity },
      seenAt: this.time,
    };
    const bearing = Math.atan2(
      this.player.y - this.ai.y,
      this.player.x - this.ai.x,
    );
    const leadTime = Math.min(
      1.8,
      Math.max(0, interceptTime(this.ai, target, target.velocity) - 23 / 220),
    );
    const leadPoint = predictedPosition(
      this.grid,
      target,
      target.velocity,
      this.ai.weapon === "laser" ? 0.65 : leadTime,
    );
    const leadAngle = Math.atan2(
      leadPoint.y - this.ai.y,
      leadPoint.x - this.ai.x,
    );
    const direct = findShot(
      this.grid,
      this.ai,
      target,
      this.ai.weapon,
      "direct",
    );
    const bank = findShot(this.grid, this.ai, target, this.ai.weapon, "bank");
    const actions: { kind: string; angle: number; fire: boolean }[] = [];
    const addAction = (kind: string, angle: number, fire: boolean) => {
      const normalized =
        ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const key = `${normalized.toFixed(3)}:${fire}`;
      if (actions.some((a) => `${a.angle.toFixed(3)}:${a.fire}` === key))
        return;
      actions.push({ kind, angle: normalized, fire });
    };
    addAction("hold", this.ai.turret, false);
    addAction("current_fire", this.ai.turret, true);
    addAction("track", bearing, false);
    if (this.ai.weapon === "mine")
      addAction("deploy_mine", this.ai.turret, true);
    else {
      addAction("bearing_fire", bearing, true);
      addAction("lead_fire", direct?.angle ?? leadAngle, true);
      addAction("left_probe", bearing - (12 * Math.PI) / 180, true);
      addAction("right_probe", bearing + (12 * Math.PI) / 180, true);
      if (bank) addAction("bank_fire", bank.angle, true);
    }

    const hazards = forecastHazards(
      this.grid,
      this.bullets,
      this.mines,
      this.beams,
    );
    const routeBefore = astar(
      this.grid,
      cell(this.ai),
      cell(this.player),
    ).length;
    const result: DirectControlCandidate[] = [];
    for (const move of Object.keys(MOVES)) {
      const motion = this.previewDirectMove(move);
      const path = [motion.end];
      const assessment = assessMotion(
        this.grid,
        this.ai,
        path,
        hazards,
        this.player,
      );
      const selfProjectileAssessment = assessMotion(
        this.grid,
        this.ai,
        path,
        hazards.filter(
          (hazard) => hazard.kind === "bullet" && hazard.owner === "ai",
        ),
        this.player,
      );
      const routeAfter = astar(
        this.grid,
        motion.endCell,
        cell(this.player),
      ).length;
      for (const action of actions) {
        const verified = action.fire
          ? traceShot(
              this.grid,
              this.ai,
              action.angle,
              target,
              this.ai.weapon,
              path,
            )
          : null;
        result.push({
          id: `c${result.length}`,
          kind: `${move}:${action.kind}`,
          move,
          aim: action.angle,
          fire: action.fire,
          durationMs: motion.horizonMs,
          motion,
          routeRemainingCells: routeAfter ? routeAfter - 1 : null,
          routeProgressCells:
            routeBefore && routeAfter ? routeBefore - routeAfter : null,
          danger: assessment.risk,
          hitIn: assessment.hitIn,
          selfProjectileHitIn: selfProjectileAssessment.hitIn,
          shot: action.fire
            ? {
                hit: this.ai.weapon === "mine" || Boolean(verified),
                bounces: verified?.bounces ?? null,
                hitIn: verified?.flightTime ?? null,
                mine: this.ai.weapon === "mine",
              }
            : null,
        });
      }
    }
    return result;
  }
  movementProbabilities() {
    const totals: Record<string, number> = {};
    for (const candidate of this.directCandidates) {
      const probability = this.controlProbabilities[candidate.id];
      if (!Number.isFinite(probability)) continue;
      totals[candidate.move] = (totals[candidate.move] || 0) + probability;
    }
    return totals;
  }
  bulletTrajectoryRows(horizon = 1.25) {
    return this.bullets.map((original, index) => {
      const bullet = { ...original };
      const points: number[][] = [
        [0, Math.round(bullet.x), Math.round(bullet.y), bullet.bounces],
      ];
      let previousBounces = bullet.bounces;
      for (
        let t = PREDICTION_STEP;
        t <= horizon + 1e-6;
        t += PREDICTION_STEP
      ) {
        const alive = advanceProjectile(this.grid, bullet, PREDICTION_STEP);
        const bounced = bullet.bounces !== previousBounces;
        const sample = Math.round(t * 1000) % 250 === 0;
        if (bounced || sample || !alive)
          points.push([
            Math.round(t * 1000),
            Math.round(bullet.x),
            Math.round(bullet.y),
            bullet.bounces,
          ]);
        previousBounces = bullet.bounces;
        if (!alive) break;
      }
      return [
        index,
        original.owner,
        Math.max(0, Math.round(180 - original.age * 1000)),
        points,
      ];
    });
  }
  controlObservation(candidates = this.directControlCandidates()) {
    const tank = (t: Tank) => ({
      x: Math.round(t.x),
      y: Math.round(t.y),
      hp: t.hp,
      weapon: t.weapon,
      ammo: t.ammo,
      cooldown: Number(t.cooldown.toFixed(2)),
      turretDeg: Math.round(((((t.turret * 180) / Math.PI) % 360) + 360) % 360),
    });
    return {
      observedAt: this.time,
      self: {
        ...tank(this.ai),
        velocity: {
          x: Math.round(this.selfVelocity.x),
          y: Math.round(this.selfVelocity.y),
        },
      },
      enemy: {
        ...tank(this.player),
        velocity: {
          x: Math.round(this.velocity.x),
          y: Math.round(this.velocity.y),
        },
      },
      navigationToEnemy: this.routeGuidance(),
      lastControlOutcome: this.lastDirectOutcome,
      currentControl: this.directAction
        ? {
            move: this.directAction.move,
            elapsedMs: Math.round(
              (this.time - this.directAction.startedAt) * 1000,
            ),
            displacementPx: Math.round(
              distance(this.directAction.start, this.directAction.end),
            ),
            pathLengthPx: Math.round(this.directAction.movedPx),
            blockedMs: Math.round(this.directAction.blockedMs),
            blockedAxes: [
              ...(this.directAction.blockedXMs > 40 ? ["x"] : []),
              ...(this.directAction.blockedYMs > 40 ? ["y"] : []),
            ],
          }
        : null,
      bullets: this.bullets.map((b) => [
        Math.round(b.x),
        Math.round(b.y),
        Math.round(b.vx),
        Math.round(b.vy),
        b.owner,
        Number(b.age.toFixed(2)),
        b.bounces,
      ]),
      pickups: this.pickups.map((p) => [
        p.id,
        p.weapon,
        Math.round(p.x),
        Math.round(p.y),
      ]),
      mines: this.mines.map((m) => [
        Math.round(m.x),
        Math.round(m.y),
        Number(m.age.toFixed(2)),
        m.owner,
      ]),
      beams: this.beams.map((b) => [
        Math.round(b.from.x),
        Math.round(b.from.y),
        Math.round(b.to.x),
        Math.round(b.to.y),
        Number(b.age.toFixed(2)),
        b.owner,
        b.fired,
      ]),
      objectColumns: {
        bullets: "x,y,vx,vy,owner,age,bounces",
        pickups: "id,weapon,x,y",
        mines: "x,y,age,owner",
        beams: "from_x,from_y,to_x,to_y,age,owner,fired",
      },
      bulletTrajectories: {
        horizonMs: 1250,
        columns:
          "bullet_index,owner,owner_immunity_remaining_ms,points[t_ms,x,y,bounces]",
        rows: this.bulletTrajectoryRows(),
        rule: "Bullets ricochet and can hit either tank, including their owner, after the owner's 180ms launch immunity expires. Treat owner=ai trajectories as self-threats.",
      },
      controlCandidates: {
        horizonMs: 1250,
        columns:
          "move,aim_deg,fire,end_x,end_y,moved_px,blocked_axes,wall_clearance_px,route_remaining_cells,route_progress_cells,danger,hit_in_s,self_projectile_hit_in_s,shot_hit,shot_bounces,shot_hit_in_s,mine",
        rows: Object.fromEntries(
          candidates.map((c) => [
            c.id,
            [
              c.move,
              Math.round((c.aim * 180) / Math.PI),
              c.fire,
              c.motion.end.x,
              c.motion.end.y,
              c.motion.movedPx,
              c.motion.blockedAxes.join("") || "none",
              c.motion.minimumWallClearancePx,
              c.routeRemainingCells,
              c.routeProgressCells,
              c.danger,
              c.hitIn === null ? null : Number(c.hitIn.toFixed(2)),
              c.selfProjectileHitIn === null
                ? null
                : Number(c.selfProjectileHitIn.toFixed(2)),
              c.shot?.hit ?? false,
              c.shot?.bounces ?? null,
              c.shot?.hitIn === null || c.shot?.hitIn === undefined
                ? null
                : Number(c.shot.hitIn.toFixed(2)),
              c.shot?.mine ?? false,
            ],
          ]),
        ),
      },
      physics: {
        coordinates:
          "pixels; x right, y down; angle degrees clockwise from right",
        controlLifetimeSeconds: 1.8,
        maximumObservationAgeSeconds: 1.8,
        projectileRule:
          "Ricochet bullets damage their shooter after 0.18s; maximum 5 bounces and 7s lifetime.",
      },
    };
  }
  async thinkDirect() {
    const start = this.clock();
    if (
      this.pending ||
      !this.running ||
      this.roundOver ||
      this.disposed ||
      start < this.nextAttemptAt ||
      start - this.lastAttemptAt < 250
    )
      return;
    this.lastAttemptAt = start;
    this.nextThink = this.time + 0.25;
    this.pending = true;
    const epoch = this.epoch,
      round = this.round,
      requested = this.time,
      weapon = this.ai.weapon;
    const controls = this.directControlCandidates();
    const state = this.controlObservation(controls);
    const trace: (typeof this.directTrace)[number] = {
      at: start,
      state,
      status: "pending",
    };
    this.directTrace.push(trace);
    if (this.directTrace.length > 200) this.directTrace.shift();
    try {
      const r = await this.ask({
        role: "controls",
        round,
        revision: this.revision,
        state,
        candidates: controls.map((c) => ({
          id: c.id,
          description: `${c.kind}; authoritative outcome is row ${c.id} in state.controlCandidates`,
          distance: c.motion.movedPx,
          risk: c.danger,
          fire: c.fire,
          kind: c.kind,
        })),
      });
      trace.result = r;
      if (epoch !== this.epoch || this.disposed) {
        trace.status = "invalidated";
        return;
      }
      this.record(r);
      this.e2eLatency = Math.round(this.clock() - start);
      if (
        r.round !== round ||
        this.clock() - start > 1800 ||
        this.time - requested > 1.8 ||
        weapon !== this.ai.weapon
      ) {
        this.discarded++;
        trace.status = "stale";
        return;
      }
      const selected = controls.find((c) => c.id === r.choice);
      if (!selected) throw Error("Jev returned an invalid control candidate");
      this.directCandidates = controls;
      this.selectedControlId = selected.id;
      this.controlProbabilities = { ...(r.probabilities || {}) };
      this.finishDirectAction();
      this.directInput = {
        move: selected.move,
        aim: selected.aim,
        fire: selected.fire,
        at: this.time,
        wall: this.clock(),
      };
      this.directAction = {
        move: selected.move,
        startedAt: this.time,
        start: { x: this.ai.x, y: this.ai.y },
        end: { x: this.ai.x, y: this.ai.y },
        movedPx: 0,
        blockedMs: 0,
        blockedXMs: 0,
        blockedYMs: 0,
      };
      // Let the newly applied input produce observable movement before the
      // next normal request. A confirmed collision can still wake it after 100ms.
      this.nextThink = this.time + 0.25;
      this.appliedInterval =
        this.lastAppliedAt < 0
          ? null
          : Math.round((this.time - this.lastAppliedAt) * 1000);
      this.lastAppliedAt = this.time;
      this.confidence = r.confidence;
      this.error = "";
      trace.status = "applied";
      trace.applied = this.clock();
      this.log(
        "OPPONENT",
        `${selected.move} · ${((selected.aim * 180) / Math.PI).toFixed(1)}° · ${selected.fire ? "fire" : "hold"}`,
        "JEV INPUT",
      );
    } catch (e) {
      trace.status = "failed";
      if (epoch === this.epoch && !this.disposed) {
        this.error = e instanceof Error ? e.message : "Control request failed";
        this.nextAttemptAt = this.clock() + 500;
      }
    } finally {
      if (epoch === this.epoch) this.pending = false;
    }
  }
  async think() {
    const wallStart = this.clock();
    if (
      this.pending ||
      (this.mode === "jev" &&
        (wallStart < this.nextAttemptAt ||
          wallStart - this.lastAttemptAt < 220)) ||
      this.time < this.failedUntil
    )
      return;
    this.lastAttemptAt = wallStart;
    const plans = this.plans(),
      epoch = this.epoch,
      requested = this.time;
    const wasVisible = this.enemyVisible,
      weapon = this.ai.weapon,
      revision = this.revision;
    this.nextThink = requested + this.cadence();
    if (!plans.length) return;
    if (this.mode === "practice") {
      const ranked = [...plans].sort((a, b) => {
        const score = (p: Plan) =>
          -p.risk * 4 +
          (p.id === "fire" ? 90 : 0) +
          (p.id === "bank" ? 75 : 0) +
          (p.pickupId && this.ai.weapon === "normal" ? 80 : 0) +
          (p.id === "chase" ? 45 : 0) +
          (p.id === "scout" ? 35 : 0) +
          (p.id === "retreat" && this.ai.hp === 1 ? 20 : 0);
        return score(b) - score(a);
      });
      this.applyPlan(ranked[0]);
      return;
    }
    this.pending = true;
    try {
      const result = await this.ask({
        role: "tank",
        round: this.round,
        revision,
        state: {
          self: {
            x: Math.round(this.ai.x),
            y: Math.round(this.ai.y),
            hp: this.ai.hp,
            weapon: this.ai.weapon,
            ammo: this.ai.ammo,
          },
          enemyVisible: this.enemyVisible,
          enemyLastSeen:
            this.observed && this.time - this.observed.seenAt < 5
              ? {
                  x: Math.round(this.observed.x),
                  y: Math.round(this.observed.y),
                  velocity: this.enemyVisible ? this.observed.velocity : null,
                  secondsAgo: Number(
                    (this.time - this.observed.seenAt).toFixed(2),
                  ),
                }
              : null,
          incomingDanger: this.risk(this.ai),
          currentPlan: this.plan?.id || "none",
          controller:
            "Local reflex predicts 0.9s of bouncing bullets, mines and lasers. It overrides imminent impacts only. Local aiming tracks observed motion but fires only with the selected plan authorization. Hidden enemy motion is unknown.",
          recentActions: this.logs
            .filter((l) => l.role === "OPPONENT")
            .slice(0, 3)
            .map((l) => l.text),
        },
        candidates: plans.map((p) => ({
          id: p.id,
          description: p.description,
          distance: Math.round(p.path.length * TILE),
          risk: p.risk,
          fire: p.fire,
        })),
      });
      if (this.disposed || epoch !== this.epoch || result.round !== this.round)
        return;
      this.record(result);
      this.e2eLatency = Math.round(this.clock() - wallStart);
      if (
        this.clock() - wallStart > 1800 ||
        this.time - requested > 1.8 ||
        wasVisible !== this.enemyVisible ||
        weapon !== this.ai.weapon ||
        revision !== this.revision
      ) {
        this.discarded++;
        this.nextThink = this.time;
        return;
      }
      const selected = plans.find((p) => p.id === result.choice);
      if (
        selected &&
        (!selected.pickupId ||
          this.pickups.some((p) => p.id === selected.pickupId))
      ) {
        this.applyPlan(selected);
        this.confidence = result.confidence;
        this.error = "";
        this.failedUntil = 0;
      }
    } catch (e) {
      if (epoch === this.epoch && !this.disposed) {
        this.error = e instanceof Error ? e.message : "Decision failed";
        this.nextThink = this.time + 2;
        this.failedUntil = this.time + 2;
        this.nextAttemptAt = this.clock() + 2000;
      }
    } finally {
      if (epoch === this.epoch) this.pending = false;
    }
  }
  applyPlan(plan: Plan) {
    const stationary = ["hold", "fire", "bank"].includes(plan.id);
    const target =
      plan.followsEnemy && this.enemyVisible && this.observed
        ? { x: this.observed.x, y: this.observed.y }
        : plan.target;
    const path = stationary ? [] : this.route(target);
    if (!stationary && !path.length) return;
    const assessment = assessMotion(
      this.grid,
      this.ai,
      path,
      this.hazards,
      this.enemyVisible ? this.observed || undefined : undefined,
    );
    // A formerly safe route becoming lethal needs a new decision, never blind execution.
    if (assessment.risk > plan.risk + 35) {
      this.discarded++;
      this.nextThink = this.time;
      return;
    }
    if (this.lastAppliedAt >= 0)
      this.appliedInterval = Math.round(
        (this.time - this.lastAppliedAt) * 1000,
      );
    this.lastAppliedAt = this.time;
    if (this.plan?.id !== plan.id) this.log("OPPONENT", plan.label);
    this.plan = { ...plan, target, path };
    this.planAge = 0;
    this.nextRoute = this.time + 0.15;
    this.nextShotCheck = this.time;
  }
  record(r: DecisionResponse) {
    this.calls++;
    this.tokens += (r.usage?.input_tokens || 0) + (r.usage?.output_tokens || 0);
    this.latency = r.latencyMs;
  }
  directorCandidates() {
    const candidates: {
      id: string;
      description: string;
      distance: number;
      risk: number;
      fire: boolean;
      kind: string;
      point?: Point;
      weapon?: Weapon;
    }[] = [
      {
        id: "wait",
        description: "Do not spawn anything this time.",
        distance: 0,
        risk: 0,
        fire: false,
        kind: "wait",
      },
    ];
    if (this.pickups.length >= 3) return candidates;
    const positions: Point[] = [];
    for (let y = 2; y < ROWS - 2; y++)
      for (let x = 2; x < COLS - 2; x++) {
        const p = center({ x, y });
        if (
          this.grid[y][x] ||
          distance(this.player, p) < 110 ||
          distance(this.ai, p) < 110 ||
          this.pickups.some((q) => distance(q, p) < 85)
        )
          continue;
        const a = astar(this.grid, cell(this.player), { x, y }).length,
          b = astar(this.grid, cell(this.ai), { x, y }).length;
        if (a && b && Math.abs(a - b) <= 3) positions.push(p);
      }
    positions.sort(
      (a, b) =>
        distance(a, { x: 456, y: 312 }) - distance(b, { x: 456, y: 312 }),
    );
    for (const p of positions) {
      if (
        candidates
          .filter((c) => c.point)
          .some((c) => distance(c.point!, p) < 100)
      )
        continue;
      for (const weapon of ["machine", "laser", "mine"] as Weapon[])
        candidates.push({
          id: `${weapon}_${Math.round(p.x)}_${Math.round(p.y)}`,
          description: `Spawn a ${weapon} pickup at grid (${cell(p).x},${cell(p).y}); travel distance is similar for both tanks.`,
          distance: Math.round(distance(this.player, p)),
          risk: 0,
          fire: false,
          kind: weapon,
          point: p,
          weapon,
        });
      if (candidates.length >= 10) break;
    }
    return candidates;
  }
  async direct() {
    const list = this.directorCandidates(),
      epoch = this.epoch;
    this.nextDirector = this.time + 12;
    if (list.length === 1) {
      this.director = "WAITING FOR A FAIR DROP ZONE";
      return;
    }
    let selected: (typeof list)[number] | undefined;
    if (this.mode === "practice")
      selected = list[1 + Math.floor(Math.random() * (list.length - 1))];
    else {
      this.directorPending = true;
      try {
        const r = await this.ask({
          role: "director",
          round: this.round,
          revision: this.revision,
          state: {
            score: this.score,
            pickups: this.pickups.map((p) => p.weapon),
            recentEvents: this.logs
              .filter((l) => l.role === "DIRECTOR")
              .slice(0, 3)
              .map((l) => l.text),
            elapsedSeconds: Math.round(this.time),
          },
          candidates: list.map(({ point, weapon, ...c }) => c),
        });
        if (this.disposed || epoch !== this.epoch || r.round !== this.round)
          return;
        this.record(r);
        selected = list.find((c) => c.id === r.choice);
      } catch (e) {
        if (epoch === this.epoch && !this.disposed) {
          this.error = e instanceof Error ? e.message : "Director request failed";
          this.director = "CONNECTION FAILED · RETRYING";
        }
      } finally {
        if (epoch === this.epoch) this.directorPending = false;
      }
    }
    if (!selected || epoch !== this.epoch) return;
    if (selected.id === "wait") {
      this.director = "HOLDING CURRENT ARENA";
      this.log("DIRECTOR", this.director);
      return;
    }
    // Revalidate using CURRENT tank positions after asynchronous inference.
    if (!this.directorCandidates().some((c) => c.id === selected!.id)) {
      this.director = "POSITIONS CHANGED · DROP DEFERRED";
      return;
    }
    this.pickups.push({
      ...selected.point!,
      id: this.nextId++,
      weapon: selected.weapon!,
      expires: this.time + 35,
    });
    this.revision++;
    this.director = `DROPPED ${WEAPONS[selected.weapon!].name}`;
    this.log("DIRECTOR", this.director);
    this.nextThink = Math.min(this.nextThink, this.time + 0.25);
  }
}
