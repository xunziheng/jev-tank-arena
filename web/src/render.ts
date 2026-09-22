import { Game, type Tank } from "./game";
import { WIDTH, HEIGHT, TILE, ROWS, COLS } from "./navigation";
import { WEAPONS } from "../../shared/types";
const rounded = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
};
export function render(ctx: CanvasRenderingContext2D, g: Game) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#101c22";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const px = x * TILE,
        py = y * TILE;
      if (g.grid[y][x]) {
        ctx.fillStyle = "#080f13";
        rounded(ctx, px + 2, py + 5, TILE - 4, TILE - 4, 5);
        ctx.fillStyle = "#26373e";
        rounded(ctx, px + 2, py + 1, TILE - 4, TILE - 6, 5);
        ctx.fillStyle = "#34484e";
        ctx.fillRect(px + 8, py + 3, TILE - 16, 2);
        ctx.fillStyle = "#1c2b31";
        ctx.fillRect(px + 9, py + TILE - 12, TILE - 18, 2);
      } else {
        ctx.strokeStyle = "#203037";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, TILE, TILE);
        ctx.fillStyle = "#30434a";
        ctx.fillRect(px + TILE / 2 - 0.7, py + TILE / 2 - 0.7, 1.4, 1.4);
      }
    }
  ctx.font = "10px monospace";
  ctx.fillStyle = "#60797f";
  ctx.textAlign = "left";
  ctx.fillText("SECTOR 01 / CONTESTED ZONE", 62, HEIGHT - 20);
  for (const p of g.pickups) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin(g.time * 2) * 0.08);
    ctx.fillStyle = WEAPONS[p.weapon].color + "15";
    rounded(ctx, -21, -21, 42, 42, 9);
    ctx.strokeStyle = WEAPONS[p.weapon].color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-15, -15, 30, 30);
    ctx.shadowColor = WEAPONS[p.weapon].color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = WEAPONS[p.weapon].color;
    ctx.font = "bold 25px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(WEAPONS[p.weapon].icon, 0, 9);
    ctx.restore();
  }
  if (g.showPaths && g.plan?.path.length) {
    ctx.beginPath();
    ctx.moveTo(g.ai.x, g.ai.y);
    for (const p of g.plan.path) ctx.lineTo(p.x, p.y);
    ctx.setLineDash([5, 7]);
    ctx.strokeStyle = "#f8a57560";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(g.plan.target.x, g.plan.target.y, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (g.showPaths && g.mode === "direct" && g.directCandidates.length) {
    const movements = new Map<string, (typeof g.directCandidates)[number]>();
    const probabilities = g.movementProbabilities();
    const hasProbabilities = Object.keys(g.controlProbabilities).length > 0;
    const moveLabels: Record<string, string> = {
      stop: "STOP",
      up: "W",
      down: "S",
      left: "A",
      right: "D",
      up_left: "W+A",
      up_right: "W+D",
      down_left: "S+A",
      down_right: "S+D",
    };
    for (const candidate of g.directCandidates)
      if (!movements.has(candidate.move))
        movements.set(candidate.move, candidate);
    const selected = g.directCandidates.find(
      (candidate) => candidate.id === g.selectedControlId,
    );
    const liveMovements = [...movements.values()].map((candidate) => ({
      candidate,
      motion: g.previewDirectMove(candidate.move),
    }));
    for (const { candidate, motion } of liveMovements) {
      const active = candidate.move === selected?.move;
      ctx.beginPath();
      ctx.moveTo(motion.start.x, motion.start.y);
      ctx.lineTo(motion.end.x, motion.end.y);
      ctx.strokeStyle = active
        ? "#ffc08c"
        : motion.blocked
          ? "#f08b6a55"
          : "#73bfa744";
      ctx.lineWidth = active ? 3 : 1.25;
      ctx.stroke();
      ctx.fillStyle = active ? "#ffc08c" : "#6f9188";
      ctx.beginPath();
      ctx.arc(
        motion.end.x,
        motion.end.y,
        active ? 4 : 2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    if (hasProbabilities) {
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      for (const { candidate, motion } of liveMovements) {
        const text = `${moveLabels[candidate.move] || candidate.move} ${(
          (probabilities[candidate.move] || 0) * 100
        ).toFixed(1)}%`;
        const width = ctx.measureText(text).width + 10;
        const x = Math.max(
          width / 2 + 3,
          Math.min(WIDTH - width / 2 - 3, motion.end.x),
        );
        const preferredY =
          candidate.move === "stop"
            ? motion.end.y + 30
            : motion.end.y - 11;
        const y = Math.max(14, Math.min(HEIGHT - 5, preferredY));
        ctx.fillStyle = "#081116d9";
        rounded(ctx, x - width / 2, y - 11, width, 15, 4);
        ctx.fillStyle =
          candidate.move === selected?.move ? "#ffc08c" : "#a7c6bc";
        ctx.fillText(text, x, y);
      }
    }
    if (selected) {
      ctx.beginPath();
      ctx.moveTo(g.ai.x, g.ai.y);
      ctx.lineTo(
        g.ai.x + Math.cos(g.ai.turret) * 80,
        g.ai.y + Math.sin(g.ai.turret) * 80,
      );
      ctx.strokeStyle = selected.fire ? "#ffdb9b" : "#a9bdc5";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  for (const m of g.mines) {
    ctx.fillStyle = m.age < 1 ? "#65514a" : "#d27865";
    ctx.beginPath();
    ctx.arc(m.x, m.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = Math.sin(g.time * 10) > 0 ? "#ffc7a2" : "#694335";
    ctx.beginPath();
    ctx.arc(m.x, m.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const b of g.beams) {
    ctx.strokeStyle = b.fired
      ? "#e1d7ff"
      : `rgba(185,165,255,${0.3 + Math.sin(g.time * 25) * 0.2})`;
    ctx.lineWidth = b.fired ? 9 : 2;
    ctx.shadowColor = "#b8a2ff";
    ctx.shadowBlur = b.fired ? 25 : 0;
    ctx.beginPath();
    ctx.moveTo(b.from.x, b.from.y);
    ctx.lineTo(b.to.x, b.to.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  for (const b of g.bullets) {
    ctx.strokeStyle = b.owner === "player" ? "#9ae5c655" : "#f6ac8155";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * 0.035, b.y - b.vy * 0.035);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = b.owner === "player" ? "#c2ffe6" : "#ffca9b";
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const t of [g.player, g.ai]) if (t.hp > 0) drawTank(ctx, t, g);
  for (const p of g.particles) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  // Aiming reticle follows actual canvas coordinates (also on high DPI screens).
  if (g.running && !g.roundOver) {
    ctx.strokeStyle = "#a2e9cb88";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(g.mouse.x, g.mouse.y, 8, 0, Math.PI * 2);
    ctx.moveTo(g.mouse.x - 13, g.mouse.y);
    ctx.lineTo(g.mouse.x + 13, g.mouse.y);
    ctx.moveTo(g.mouse.x, g.mouse.y - 13);
    ctx.lineTo(g.mouse.x, g.mouse.y + 13);
    ctx.stroke();
  }
  if (g.mode === "direct" && g.ai.hp > 0) drawControls(ctx, g);
}
function drawTank(ctx: CanvasRenderingContext2D, t: Tank, g: Game) {
  const color = t.id === "player" ? "#9de5c5" : "#f5a475",
    dark = t.id === "player" ? "#43786b" : "#8c5844";
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.angle);
  ctx.fillStyle = "#05090c88";
  rounded(ctx, -18, -14, 40, 34, 7);
  ctx.fillStyle = "#071014";
  rounded(ctx, -18, -18, 36, 10, 3);
  rounded(ctx, -18, 8, 36, 10, 3);
  ctx.strokeStyle = "#627576";
  ctx.lineWidth = 2;
  for (let x = -13; x <= 13; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, -16);
    ctx.lineTo(x, -10);
    ctx.moveTo(x, 10);
    ctx.lineTo(x, 16);
    ctx.stroke();
  }
  ctx.fillStyle = dark;
  rounded(ctx, -17, -11, 34, 22, 4);
  ctx.fillStyle = color;
  rounded(ctx, -13, -10, 27, 18, 4);
  ctx.fillStyle = dark;
  ctx.fillRect(-10, -7, 6, 12);
  ctx.restore();
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.turret);
  ctx.fillStyle = "#0a1418";
  rounded(ctx, -8, -9, 19, 18, 6);
  ctx.fillStyle = color;
  rounded(ctx, -7, -8, 16, 16, 5);
  ctx.fillStyle = WEAPONS[t.weapon].color;
  rounded(ctx, 5, -3, 23, 6, 2);
  ctx.fillStyle = dark;
  ctx.fillRect(24, -4, 5, 8);
  ctx.restore();
  ctx.font = "bold 9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.fillText(
    t.id === "player" ? "YOU" : g.mode !== "practice" ? "JEV" : "LOCAL",
    t.x,
    t.y - 29,
  );
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < t.hp ? color : "#263c43";
    ctx.fillRect(t.x - 13 + i * 9, t.y + 26, 7, 3);
  }
}

// Draw last so effects never cover the input readout. Clamp within the arena.
function drawControls(ctx: CanvasRenderingContext2D, g: Game) {
  const input = g.directInput;
  const active = Boolean(g.running && !g.roundOver && g.directStatus());
  const moves: Record<string, string> = {
    stop: "STOP",
    up: "W",
    down: "S",
    left: "A",
    right: "D",
    up_left: "W+A",
    up_right: "W+D",
    down_left: "S+A",
    down_right: "S+D",
  };
  const angle = ((((g.ai.turret * 180) / Math.PI) % 360) + 360) % 360;
  const action = `${moves[active && input ? input.move : "stop"]} · AIM ${angle.toFixed(0)}° · ${active && input?.fire ? "FIRE" : "HOLD"}`;
  ctx.save();
  ctx.font = "bold 11px sans-serif";
  const width = ctx.measureText(action).width + 20;
  const x = Math.max(6, Math.min(WIDTH - width - 6, g.ai.x - width / 2));
  const y = Math.max(6, g.ai.y - 61);
  ctx.fillStyle = "rgba(5, 13, 18, 0.94)";
  rounded(ctx, x, y, width, 24, 6);
  ctx.strokeStyle = active ? "#f5a475" : "#627576";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffe0c9";
  ctx.fillText(action, x + width / 2, y + 12);
  ctx.restore();
}
