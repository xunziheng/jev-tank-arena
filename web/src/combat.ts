import type { Point, Weapon } from "../../shared/types";
import {
  blocked,
  distance,
  segmentDistance,
  TILE,
  visible,
  type Grid,
} from "./navigation";

export const TANK_SPEED = 116;
export const BULLET_SPEED = 220;
export const PREDICTION_STEP = 0.025;
export const THREAT_HORIZON = 0.9;
export type Projectile = Point & {
  vx: number;
  vy: number;
  age: number;
  bounces: number;
  owner: string;
};
export type Observation = Point & { velocity: Point; seenAt: number };
export type Shot = {
  angle: number;
  bounces: number;
  flightTime: number;
  miss: number;
};
export type TimedPoint = Point & { t: number; bounces?: number };
export type Hazard = {
  points: TimedPoint[];
  damage: number;
  radius: number;
  owner: string;
  age: number;
  kind: "bullet" | "beam" | "mine";
};
export type MotionAssessment = {
  risk: number;
  clearance: number;
  hitIn: number | null;
  end: Point;
};

// Both live bullets and rollouts use identical substeps, wall radius and bounce limits.
export function advanceProjectile(
  grid: Grid,
  b: Projectile,
  dt: number,
  onStep?: (p: Projectile) => boolean,
): boolean {
  const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 2));
  const step = dt / steps;
  for (let i = 0; i < steps; i++) {
    b.age += step;
    if (b.age > 7 || b.bounces > 5) return false;
    const old = { x: b.x, y: b.y },
      nx = b.x + b.vx * step,
      ny = b.y + b.vy * step;
    const hitX = blocked(grid, nx, b.y, 3),
      hitY = blocked(grid, b.x, ny, 3);
    if (hitX) b.vx = -b.vx;
    else b.x = nx;
    if (hitY) b.vy = -b.vy;
    else b.y = ny;
    if (hitX || hitY) b.bounces++;
    if (!hitX && !hitY && blocked(grid, b.x, b.y, 3)) {
      b.x = old.x;
      b.y = old.y;
      b.vx = -b.vx;
      b.vy = -b.vy;
      b.bounces++;
    }
    if (b.bounces > 5) return false;
    if (onStep?.(b) === false) return false;
  }
  return true;
}
export function predictedPosition(
  grid: Grid,
  start: Point,
  velocity: Point,
  t: number,
  radius = 15,
): Point {
  const p = { ...start },
    steps = Math.max(1, Math.ceil(t / 0.025)),
    dt = t / steps;
  for (let i = 0; i < steps; i++) {
    if (!blocked(grid, p.x + velocity.x * dt, p.y, radius))
      p.x += velocity.x * dt;
    if (!blocked(grid, p.x, p.y + velocity.y * dt, radius))
      p.y += velocity.y * dt;
  }
  return p;
}
export function interceptTime(
  shooter: Point,
  target: Point,
  velocity: Point,
  speed = BULLET_SPEED,
): number {
  const x = target.x - shooter.x,
    y = target.y - shooter.y;
  const a = velocity.x ** 2 + velocity.y ** 2 - speed ** 2,
    b = 2 * (x * velocity.x + y * velocity.y),
    c = x * x + y * y;
  if (Math.abs(a) < 1e-7) return b < 0 ? -c / b : Math.sqrt(c) / speed;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Math.sqrt(c) / speed;
  const roots = [
    (-b - Math.sqrt(disc)) / (2 * a),
    (-b + Math.sqrt(disc)) / (2 * a),
  ].filter((t) => t >= 0);
  return roots.length ? Math.min(...roots) : Math.sqrt(c) / speed;
}
export function traceShot(
  grid: Grid,
  shooter: Point,
  angle: number,
  target: Observation,
  weapon: Weapon,
  path: Point[] = [],
): Shot | null {
  const start = {
    x: shooter.x + Math.cos(angle) * 23,
    y: shooter.y + Math.sin(angle) * 23,
  };
  if (blocked(grid, start.x, start.y, 4)) return null;
  if (weapon === "laser") {
    const predicted = predictedPosition(grid, target, target.velocity, 0.65);
    if (!visible(grid, start, predicted)) return null;
    const end = {
      x: start.x + Math.cos(angle) * 1200,
      y: start.y + Math.sin(angle) * 1200,
    };
    const miss = segmentDistance(predicted, start, end);
    return miss < 15 ? { angle, bounces: 0, flightTime: 0.65, miss } : null;
  }
  const b: Projectile = {
    ...start,
    vx: Math.cos(angle) * BULLET_SPEED,
    vy: Math.sin(angle) * BULLET_SPEED,
    age: 0,
    bounces: 0,
    owner: "ai",
  };
  let result: Shot | null = null;
  let enemy: Point = { x: target.x, y: target.y };
  const future = pathPrediction(grid, shooter, path, 1.8);
  for (let t = 0; t < 1.8; t += PREDICTION_STEP) {
    enemy = predictedPosition(grid, enemy, target.velocity, PREDICTION_STEP);
    const self =
      future[
        Math.min(
          future.length - 1,
          Math.round((t + PREDICTION_STEP) / PREDICTION_STEP),
        )
      ];
    let unsafe = false;
    const alive = advanceProjectile(grid, b, PREDICTION_STEP, (p) => {
      if (p.age >= 0.18 && distance(p, self) < 21) {
        unsafe = true;
        return false;
      }
      const miss = distance(p, enemy);
      if (miss < 15) {
        result = { angle, bounces: p.bounces, flightTime: p.age, miss };
        return false;
      }
      return true;
    });
    if (unsafe) return null;
    if (result) return result;
    if (!alive || b.bounces > 1) return null;
  }
  return null;
}
export function selfHitTimeForShot(
  grid: Grid,
  shooter: Point,
  target: Observation,
  angle: number,
  weapon: Weapon,
  path: Point[] = [],
  horizon = 3,
): number | null {
  const future = pathPrediction(grid, shooter, path, horizon, target);
  if (weapon === "mine") {
    const atArming = future[Math.min(future.length - 1, Math.round(1 / PREDICTION_STEP))];
    return distance(atArming, shooter) < 27 ? 1 : null;
  }
  if (weapon === "laser") return null;
  const bullet: Projectile = {
    x: shooter.x + Math.cos(angle) * 23,
    y: shooter.y + Math.sin(angle) * 23,
    vx: Math.cos(angle) * BULLET_SPEED,
    vy: Math.sin(angle) * BULLET_SPEED,
    age: 0,
    bounces: 0,
    owner: "ai",
  };
  if (blocked(grid, bullet.x, bullet.y, 4)) return null;
  let enemy: Point = { x: target.x, y: target.y };
  for (let t = PREDICTION_STEP; t <= horizon + 1e-6; t += PREDICTION_STEP) {
    enemy = predictedPosition(grid, enemy, target.velocity, PREDICTION_STEP);
    const self = future[Math.min(future.length - 1, Math.round(t / PREDICTION_STEP))];
    let hitSelf = false,
      hitEnemy = false;
    const alive = advanceProjectile(grid, bullet, PREDICTION_STEP, (projectile) => {
      if (distance(projectile, enemy) < 17) {
        hitEnemy = true;
        return false;
      }
      if (projectile.age >= 0.18 && distance(projectile, self) < 17) {
        hitSelf = true;
        return false;
      }
      return true;
    });
    if (hitEnemy) return null;
    if (hitSelf) return Number(t.toFixed(2));
    if (!alive) return null;
  }
  return null;
}
export function findShot(
  grid: Grid,
  shooter: Point,
  target: Observation,
  weapon: Weapon,
  kind: "direct" | "bank" | "auto" = "auto",
  path: Point[] = [],
): Shot | null {
  if (weapon === "mine") return null;
  const lead =
    weapon === "laser"
      ? 0.65
      : Math.min(
          1.8,
          Math.max(
            0,
            interceptTime(shooter, target, target.velocity) - 23 / BULLET_SPEED,
          ),
        );
  const aimPoint = predictedPosition(grid, target, target.velocity, lead);
  const direct = traceShot(
    grid,
    shooter,
    Math.atan2(aimPoint.y - shooter.y, aimPoint.x - shooter.x),
    target,
    weapon,
    path,
  );
  if (kind !== "bank" && direct?.bounces === 0) return direct;
  if (kind === "direct" || weapon === "laser") return null;
  // Reflect the target in each exposed wall face, then verify the complete shot in the real integrator.
  const angles = new Map<string, number>();
  for (let y = 0; y < grid.length; y++)
    for (let x = 0; x < grid[y].length; x++) {
      if (!grid[y][x]) continue;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        if (grid[y + dy]?.[x + dx] !== 0) continue;
        const vertical = dx !== 0,
          edge = vertical
            ? dx < 0
              ? x * TILE - 3
              : (x + 1) * TILE + 3
            : dy < 0
              ? y * TILE - 3
              : (y + 1) * TILE + 3;
        let reflected: Point = aimPoint,
          predicted = aimPoint,
          crossing = 0;
        let a = 0;
        for (let iteration = 0; iteration < 3; iteration++) {
          reflected = vertical
            ? { x: 2 * edge - predicted.x, y: predicted.y }
            : { x: predicted.x, y: 2 * edge - predicted.y };
          a = Math.atan2(reflected.y - shooter.y, reflected.x - shooter.x);
          const denom = vertical
            ? reflected.x - shooter.x
            : reflected.y - shooter.y;
          const u =
            (edge - (vertical ? shooter.x : shooter.y)) / (denom || 1e-9);
          crossing = vertical
            ? shooter.y + u * (reflected.y - shooter.y)
            : shooter.x + u * (reflected.x - shooter.x);
          if (u <= 0 || u >= 1) {
            crossing = -Infinity;
            break;
          }
          const flight = Math.min(
            1.8,
            Math.max(0, (distance(shooter, reflected) - 23) / BULLET_SPEED),
          );
          predicted = predictedPosition(grid, target, target.velocity, flight);
        }
        const lo = (vertical ? y : x) * TILE,
          hi = lo + TILE;
        if (crossing > lo + 3 && crossing < hi - 3) angles.set(a.toFixed(4), a);
      }
    }
  let best: Shot | null = null;
  for (const a of angles.values()) {
    const shot = traceShot(grid, shooter, a, target, weapon, path);
    if (shot?.bounces === 1 && (!best || shot.flightTime < best.flightTime))
      best = shot;
  }
  return best;
}
export function pathPrediction(
  grid: Grid,
  start: Point,
  path: Point[],
  horizon = THREAT_HORIZON,
  other?: Point,
): TimedPoint[] {
  const p = { ...start },
    points: TimedPoint[] = [{ ...p, t: 0 }];
  let index = 0;
  for (let t = PREDICTION_STEP; t <= horizon + 1e-6; t += PREDICTION_STEP) {
    let remaining = TANK_SPEED * PREDICTION_STEP;
    while (index < path.length && remaining > 0) {
      const q = path[index],
        d = distance(p, q);
      if (d < 0.1) {
        index++;
        continue;
      }
      const step = Math.min(d, remaining),
        nx = p.x + ((q.x - p.x) * step) / d,
        ny = p.y + ((q.y - p.y) * step) / d;
      if (
        !blocked(grid, nx, p.y, 15) &&
        (!other || distance({ x: nx, y: p.y }, other) >= 30)
      )
        p.x = nx;
      if (
        !blocked(grid, p.x, ny, 15) &&
        (!other || distance({ x: p.x, y: ny }, other) >= 30)
      )
        p.y = ny;
      remaining -= step;
      if (distance(p, q) < 0.1) index++;
      else break;
    }
    points.push({ ...p, t });
  }
  return points;
}
export function forecastHazards(
  grid: Grid,
  bullets: Projectile[],
  mines: (Point & { age: number })[],
  beams: {
    from: Point;
    to: Point;
    age: number;
    owner: string;
    fired: boolean;
  }[],
): Hazard[] {
  const hazards: Hazard[] = [];
  for (const original of bullets) {
    const b = { ...original },
      points: TimedPoint[] = [{ x: b.x, y: b.y, t: 0, bounces: b.bounces }];
    for (
      let t = PREDICTION_STEP;
      t <= THREAT_HORIZON + 1e-6;
      t += PREDICTION_STEP
    ) {
      if (!advanceProjectile(grid, b, PREDICTION_STEP)) break;
      points.push({ x: b.x, y: b.y, t, bounces: b.bounces });
    }
    hazards.push({
      points,
      damage: 1,
      radius: 19,
      owner: b.owner,
      age: original.age,
      kind: "bullet",
    });
  }
  for (const m of mines)
    if (m.age < 25)
      hazards.push({
        points: [{ ...m, t: Math.max(0, 1 - m.age) }],
        damage: 2,
        radius: 29,
        owner: "any",
        age: m.age,
        kind: "mine",
      });
  for (const b of beams)
    if (!b.fired && b.age < 0.65)
      hazards.push({
        points: [
          { ...b.from, t: 0.65 - b.age },
          { ...b.to, t: 0.65 - b.age },
        ],
        damage: 2,
        radius: 21,
        owner: b.owner,
        age: b.age,
        kind: "beam",
      });
  return hazards;
}
export function assessMotion(
  grid: Grid,
  start: Point,
  path: Point[],
  hazards: Hazard[],
  other?: Point,
): MotionAssessment {
  const motion = pathPrediction(grid, start, path, THREAT_HORIZON, other);
  let risk = 0,
    clearance = 200,
    hitIn: number | null = null;
  for (const h of hazards) {
    let closest = Infinity,
      when = 0,
      firstImpact: number | null = null;
    if (h.kind === "beam") {
      if (h.owner === "ai" || h.points[0].t > THREAT_HORIZON) continue;
      const p =
        motion[
          Math.min(
            motion.length - 1,
            Math.round(h.points[0].t / PREDICTION_STEP),
          )
        ];
      closest = segmentDistance(p, h.points[0], h.points[1]) - h.radius;
      when = h.points[0].t;
    } else if (h.kind === "mine") {
      for (const p of motion)
        if (
          p.t + h.age > 1 &&
          p.t + h.age <= 25 &&
          visible(grid, p, h.points[0])
        ) {
          const d = distance(p, h.points[0]) - h.radius;
          if (d <= 0 && firstImpact === null) firstImpact = p.t;
          if (d < closest) {
            closest = d;
            when = p.t;
          }
        }
    } else {
      for (let i = 1; i < h.points.length; i++) {
        const a = h.points[i - 1],
          b = h.points[i];
        if (h.owner === "ai" && h.age + b.t < 0.18) continue;
        const p = motion[Math.min(i, motion.length - 1)],
          prev = motion[Math.min(i - 1, motion.length - 1)];
        const d =
          segmentDistance(
            { x: 0, y: 0 },
            { x: a.x - prev.x, y: a.y - prev.y },
            { x: b.x - p.x, y: b.y - p.y },
          ) - h.radius;
        if (d <= 0 && firstImpact === null) firstImpact = b.t;
        if (d < closest) {
          closest = d;
          when = b.t;
        }
      }
    }
    clearance = Math.min(clearance, closest);
    if (closest <= 0) {
      risk += h.damage * 40 + (THREAT_HORIZON - when) * 20;
      const impact = firstImpact ?? when;
      hitIn = hitIn === null ? impact : Math.min(hitIn, impact);
    } else if (closest < 14) risk += (14 - closest) * 0.4;
  }
  return {
    risk: Math.min(100, Math.round(risk)),
    clearance,
    hitIn,
    end: motion.at(-1)!,
  };
}
export function decisionInterval(
  visibleEnemy: boolean,
  danger: boolean,
  hasObjective: boolean,
): number {
  return danger || visibleEnemy ? 0.25 : hasObjective ? 0.5 : 0.9;
}
