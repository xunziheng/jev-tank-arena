import {
  advanceProjectile,
  findShot,
  interceptTime,
  predictedPosition,
  forecastHazards,
  assessMotion,
  decisionInterval,
  TANK_SPEED,
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
};
export type DecisionTransport = (
  body: DecisionRequest,
  signal: AbortSignal,
) => Promise<DecisionResponse>;
export class Game {
  grid: Grid = makeArena();
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
  reflexLabel = "监测弹道";
  shotType = "等待射击授权";
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
  director = "等待战场开始";
  nextThink = 0;
  nextDirector = 2;
  pending = false;
  directorPending = false;
  epoch = 0;
  nextId = 1;
  controllers = new Set<AbortController>();
  disposed = false;
  constructor(
    public transport: DecisionTransport,
    public clock: () => number = () => performance.now(),
  ) {
    this.player = this.newTank("player");
    this.ai = this.newTank("ai");
  }
  newTank(id: "player" | "ai"): Tank {
    return {
      ...center(
        id === "player" ? { x: 1, y: 1 } : { x: COLS - 2, y: ROWS - 2 },
      ),
      id,
      angle: id === "player" ? 0 : Math.PI,
      turret: id === "player" ? 0 : Math.PI,
      hp: 3,
      weapon: "normal",
      ammo: 0,
      cooldown: 0,
    };
  }
  log(
    role: string,
    text: string,
    source = this.mode === "jev" ? "JEV" : "LOCAL",
  ) {
    this.logs = [
      { id: this.nextId++, time: this.time, role, text, source },
      ...this.logs,
    ].slice(0, 30);
  }
  invalidate() {
    this.epoch++;
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
    this.grid = makeArena();
    this.round = 1;
    this.time = 0;
    this.score = [0, 0];
    this.winner = "";
    this.logs = [];
    this.error = "";
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
    this.revision++;
    this.player = this.newTank("player");
    this.ai = this.newTank("ai");
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
    this.director = "等待投放时机";
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
      plan: this.plan?.label || "等待决策",
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
      cadence: Math.round(this.cadence() * 1000),
      reflex: this.reflexPath ? "本地紧急闪避" : "监测弹道",
      reflexCount: this.reflexCount,
      discarded: this.discarded,
      shotType: this.shotType,
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
    this.move(this.player, dx, dy, dt);
    this.player.turret = Math.atan2(
      this.mouse.y - this.player.y,
      this.mouse.x - this.player.x,
    );
    if (this.mouse.down || this.keys.has("Space")) this.shoot(this.player);
    this.observeEnemy(dt);
    this.executeCombat(dt);
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
            t.id === "player" ? "玩家" : "对手",
            `拾取${WEAPONS[p.weapon].name}`,
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
        "回合",
        this.player.hp === 0 && this.ai.hp === 0
          ? "同归于尽"
          : this.player.hp > 0
            ? "玩家拿下一分"
            : "对手拿下一分",
        "GAME",
      );
      if (Math.max(...this.score) >= 5) {
        this.winner = this.score[0] >= 5 ? "你赢了这场对决" : "对手赢得了比赛";
        this.running = false;
      }
      return;
    }
    if (this.time >= this.nextThink && !this.pending) void this.think();
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
      this.shotType = "等待射击授权";
      return;
    }
    if (this.ai.weapon === "mine") {
      this.shotType = "检查布雷撤离路线";
      if (this.plan.attack === "mine" && !dodging && this.safeMineEscape())
        this.shoot(this.ai);
      return;
    }
    const remembered = this.shootingObservation();
    if (!remembered || (!this.enemyVisible && this.plan.attack !== "bank")) {
      this.currentShot = null;
      this.shotType = "失去视野，停止跟踪";
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
            ? "一次反弹射击"
            : "按最近记忆反弹射击"
          : "提前量直射";
        if (this.ai.cooldown <= 0) this.shoot(this.ai);
      } else this.shotType = "无安全射击窗口";
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
      this.log("反射层", "预测到伤害，执行紧急闪避", "LOCAL REFLEX");
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
    add("hold", "观察战场", "Hold current position without firing.", this.ai);
    if (hasShot) {
      add(
        "fire",
        "瞄准开火",
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
        "反弹截击",
        this.enemyVisible
          ? "Fire a verified one-bounce shot at the currently observed enemy. Local controller continuously rechecks the shot."
          : "Fire a one-bounce shot at a frozen last-seen position less than 0.75s old. Enemy may have moved; this is uncertain, not wall vision.",
        this.ai,
        true,
      );
    if (known)
      add(
        "chase",
        "追击目标",
        "Track the enemy while visible; pursue last observed position when hidden. Authorize locally verified safe shots during pursuit.",
        known,
        this.ai.weapon !== "mine",
      );
    for (const p of this.pickups)
      add(
        `pickup_${p.id}`,
        `争夺${WEAPONS[p.weapon].name}`,
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
        "侧移 / 闪避",
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
        "转移到掩体",
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
        "搜索战场",
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
      body.role === "tank" ? 3000 : 8500,
    );
    try {
      return await this.transport(body, controller.signal);
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
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
            .filter((l) => l.role === "对手")
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
        this.error = e instanceof Error ? e.message : "决策失败";
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
    if (this.plan?.id !== plan.id) this.log("对手", plan.label);
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
      this.director = "等待新的争夺空间";
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
              .filter((l) => l.role === "导演")
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
          this.error = e instanceof Error ? e.message : "导演调用失败";
          this.director = "连接失败，稍后重试";
        }
      } finally {
        if (epoch === this.epoch) this.directorPending = false;
      }
    }
    if (!selected || epoch !== this.epoch) return;
    if (selected.id === "wait") {
      this.director = "保持当前战场";
      this.log("导演", this.director);
      return;
    }
    // Revalidate using CURRENT tank positions after asynchronous inference.
    if (!this.directorCandidates().some((c) => c.id === selected!.id)) {
      this.director = "位置已变化，等待下次投放";
      return;
    }
    this.pickups.push({
      ...selected.point!,
      id: this.nextId++,
      weapon: selected.weapon!,
      expires: this.time + 35,
    });
    this.revision++;
    this.director = `投放${WEAPONS[selected.weapon!].name}`;
    this.log("导演", this.director);
    this.nextThink = Math.min(this.nextThink, this.time + 0.25);
  }
}
