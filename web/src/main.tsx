import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Game, type Snapshot } from "./game";
import { render } from "./render";
import { WIDTH, HEIGHT } from "./navigation";
import { WEAPONS, type Mode } from "../../shared/types";
import "./style.css";
const transport: ConstructorParameters<typeof Game>[0] = async (
  body,
  signal,
) => {
  const r = await fetch("/api/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "服务暂不可用");
  return data;
};
function App() {
  const canvas = useRef<HTMLCanvasElement>(null),
    game = useRef<Game | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null),
    [health, setHealth] = useState<{
      configured: boolean;
      model: string;
    } | null>(null),
    [healthError, setHealthError] = useState(false);
  const [mode, setMode] = useState<Mode>("jev"),
    [paths, setPaths] = useState(true),
    [help, setHelp] = useState(false);
  const refresh = () => {
    setHealthError(false);
    void fetch("/api/health")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setHealth)
      .catch(() => {
        setHealth(null);
        setHealthError(true);
      });
  };
  useEffect(() => {
    refresh();
    const g = new Game(transport);
    game.current = g;
    setSnap(g.snapshot());
    const el = canvas.current!,
      ctx = el.getContext("2d")!;
    let animation = 0,
      last = performance.now(),
      lastUi = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      el.width = WIDTH * dpr;
      el.height = HEIGHT * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const frame = (now: number) => {
      g.update((now - last) / 1000);
      last = now;
      render(ctx, g);
      if (now - lastUi > 100) {
        setSnap(g.snapshot());
        lastUi = now;
      }
      animation = requestAnimationFrame(frame);
    };
    animation = requestAnimationFrame(frame);
    const keyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        ["INPUT", "SELECT", "BUTTON"].includes(e.target.tagName)
      )
        return;
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Space",
        ].includes(e.code)
      ) {
        e.preventDefault();
        g.keys.add(e.code);
      }
      if (e.code === "KeyP" && !e.repeat && g.running) {
        g.toggle();
        setSnap(g.snapshot());
      }
    };
    const keyUp = (e: KeyboardEvent) => g.keys.delete(e.code);
    const release = () => {
      g.keys.clear();
      g.mouse.down = false;
    };
    const blur = () => {
      release();
      if (g.running) {
        g.toggle();
        setSnap(g.snapshot());
      }
    };
    const hidden = () => {
      if (document.hidden) blur();
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    window.addEventListener("pointerup", release);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      g.dispose();
      cancelAnimationFrame(animation);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const start = () => {
    if (mode === "jev" && !health?.configured) return;
    game.current?.toggle();
    setSnap(game.current!.snapshot());
    canvas.current?.focus();
  };
  const restart = () => {
    game.current?.reset(mode);
    setSnap(game.current!.snapshot());
  };
  const changeMode = (m: Mode) => {
    setMode(m);
    game.current?.reset(m);
    setSnap(game.current!.snapshot());
  };
  const moveMouse = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (game.current) {
      game.current.mouse.x = ((e.clientX - r.left) * WIDTH) / r.width;
      game.current.mouse.y = ((e.clientY - r.top) * HEIGHT) / r.height;
    }
  };
  const ready = mode === "practice" || health?.configured;
  const time = snap
    ? `${Math.floor(snap.time / 60)
        .toString()
        .padStart(2, "0")}:${Math.floor(snap.time % 60)
        .toString()
        .padStart(2, "0")}`
    : "00:00";
  return (
    <div className="app">
      <header>
        <a className="brand" href="/" aria-label="Jev Arena 首页">
          <span className="mark">
            J<span>·</span>
          </span>
          <div>
            JEV<span className="brand-light"> ARENA</span>
            <small>人类直觉，对阵机器决策。</small>
          </div>
        </a>
        <div className="header-right">
          <span
            className={
              "status " +
              (mode === "practice"
                ? "practice"
                : health?.configured
                  ? "online"
                  : "")
            }
          >
            <i />
            {mode === "practice"
              ? "本地练习 · 非 Jev"
              : health?.configured
                ? snap?.calls
                  ? "JEV 已连接"
                  : "JEV 已配置"
                : healthError
                  ? "服务未连接"
                  : "JEV 待配置"}
          </span>
          <button
            className="icon-button"
            onClick={() => setHelp(!help)}
            aria-label="操作说明"
          >
            ?
          </button>
        </div>
      </header>
      <main>
        <section className="battle-section">
          <div className="section-top">
            <div>
              <span className="eyebrow">HUMAN × MACHINE</span>
              <h1>
                一场会思考的对决<span> / 01</span>
              </h1>
            </div>
            <span className="round">
              ROUND {String(snap?.round || 1).padStart(2, "0")} <b>·</b> 先得 5
              分
            </span>
          </div>
          <div className="arena-shell">
            <div className="scorebar">
              <div className="competitor">
                <span className="tank-dot green">▰</span>
                <strong>YOU</strong>
                <span className="hearts">
                  {"●".repeat(snap?.hp[0] ?? 3)}
                  <em>{"○".repeat(3 - (snap?.hp[0] ?? 3))}</em>
                </span>
              </div>
              <div className="score">
                <b>{snap?.score[0] || 0}</b>
                <span>:</span>
                <b>{snap?.score[1] || 0}</b>
                <small>{time}</small>
              </div>
              <div className="competitor enemy">
                <span className="hearts">
                  {"●".repeat(snap?.hp[1] ?? 3)}
                  <em>{"○".repeat(3 - (snap?.hp[1] ?? 3))}</em>
                </span>
                <strong>{mode === "jev" ? "JEV" : "LOCAL"}</strong>
                <span className="tank-dot orange">▰</span>
              </div>
            </div>
            <div className="canvas-wrap">
              <canvas
                ref={canvas}
                aria-label="坦克战场，WASD 移动，鼠标瞄准，点击开火"
                tabIndex={0}
                onPointerMove={moveMouse}
                onPointerDown={(e) => {
                  moveMouse(e);
                  e.currentTarget.focus();
                  if (game.current && e.button === 0)
                    game.current.mouse.down = true;
                }}
                onContextMenu={(e) => e.preventDefault()}
              />
              {(!snap?.running || snap.roundOver) && (
                <div className="arena-overlay">
                  <div className="overlay-card">
                    <span className="eyebrow">
                      {snap?.winner
                        ? "MATCH COMPLETE"
                        : snap?.roundOver
                          ? "ROUND COMPLETE"
                          : "TACTICAL PLAYGROUND"}
                    </span>
                    <h2>
                      {snap?.winner ||
                        (snap?.roundOver
                          ? "下一回合，即将开始"
                          : snap && snap.time > 0
                            ? "战场已暂停"
                            : "你的直觉，它的判断。")}
                    </h2>
                    <p>
                      {snap?.roundOver
                        ? "重新部署坦克，保留比分。"
                        : mode === "practice"
                          ? "本地规则对手与随机道具，用于体验操控。"
                          : "驾驶绿色坦克，挑战由 Jev 决策的橙色对手。"}
                    </p>
                    {!snap?.roundOver && (
                      <button
                        className="primary"
                        disabled={!ready && !snap?.winner}
                        onClick={snap?.winner ? restart : start}
                      >
                        {snap?.winner
                          ? "重新挑战"
                          : snap && snap.time > 0
                            ? "继续对决 →"
                            : "进入战场 →"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="arena-footer">
              <span>
                <i className="legend-dot green" /> 玩家{" "}
                <i className="legend-dot orange" />{" "}
                {mode === "jev" ? "Jev 对手" : "规则对手"}
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={paths}
                  onChange={(e) => {
                    setPaths(e.target.checked);
                    if (game.current) game.current.showPaths = e.target.checked;
                  }}
                />{" "}
                显示 AI 路线
              </label>
              <span>反弹炮弹也会击中自己</span>
            </div>
          </div>
          <div className="controls">
            <div className="key-guide">
              <span>
                <kbd>W</kbd>
                <kbd>A</kbd>
                <kbd>S</kbd>
                <kbd>D</kbd> 移动
              </span>
              <span>
                <kbd>↖</kbd> 鼠标瞄准
              </span>
              <span>
                <kbd>CLICK</kbd> 开火 / 布雷
              </span>
            </div>
            <div className="actions">
              <button onClick={restart}>↻ 重开</button>
              <button
                className="primary small"
                disabled={!ready || !!snap?.winner}
                onClick={start}
              >
                {snap?.running ? "Ⅱ 暂停" : "▶ 开始"}
              </button>
            </div>
          </div>
          <div className="bottom-note">
            <span>01 / 试探、绕行、争夺武器。</span>
            <span>每一条路线，都是一次选择。</span>
          </div>
        </section>
        <aside>
          <section className="panel connection">
            <div className="panel-title">
              <span>决策引擎</span>
              <span className="eyebrow">ENGINE</span>
            </div>
            <div className="mode-switch">
              <button
                className={mode === "jev" ? "active" : ""}
                onClick={() => changeMode("jev")}
              >
                Jev 实战
              </button>
              <button
                className={mode === "practice" ? "active" : ""}
                onClick={() => changeMode("practice")}
              >
                本地练习
              </button>
            </div>
            {mode === "jev" && !health?.configured ? (
              <div className="setup">
                <strong>
                  {healthError ? "无法连接本地服务" : "连接你的 Jev"}
                </strong>
                <p>
                  {healthError
                    ? "请确认 npm run dev 正在运行。"
                    : "在项目 .env 中配置 TYPESAFE_API_KEY，然后重启服务。密钥仅保存在服务端。"}
                </p>
                <button onClick={refresh}>↻ 检查连接</button>
              </div>
            ) : (
              <p className="subtle">
                {mode === "practice"
                  ? "规则 AI + 随机投放。不会调用或模拟 Jev 输出。"
                  : `${health?.model} · Jev 战术 + 本地反射`}
              </p>
            )}
          </section>
          <section className="panel">
            <div className="panel-title">
              <span>
                <i className="legend-dot orange" /> 对手正在做什么
              </span>
              <span className={"pulse " + (snap?.pending ? "thinking" : "")}>
                {snap?.pending ? "判断中" : "LIVE"}
              </span>
            </div>
            <div className="intent">{snap?.plan || "等待决策"}</div>
            <div className="combat-status">
              <span>{snap?.reflex || "监测弹道"}</span>
              <span>{snap?.shotType || "等待射击授权"}</span>
            </div>
            <div className="weapon-line">
              <span>当前武器</span>
              <strong>
                {WEAPONS[snap?.weapons[1] || "normal"].name}{" "}
                <small>
                  {snap?.weapons[1] !== "normal" ? snap?.ammo[1] : "∞"}
                </small>
              </strong>
            </div>
            <div className="metrics">
              <div>
                <b>
                  {mode === "jev" && snap?.latency ? `${snap.latency}` : "—"}
                  <small> ms</small>
                </b>
                <span>最近调用</span>
              </div>
              <div>
                <b>
                  {mode === "jev" && snap?.confidence != null
                    ? `${Math.round(snap.confidence * 100)}%`
                    : "—"}
                </b>
                <span>选择置信度</span>
              </div>
            </div>
            <div className="combat-telemetry">
              <span>
                目标间隔 <b>{snap?.cadence || 900} ms</b>
              </span>
              <span>
                实际应用间隔{" "}
                <b>
                  {snap?.appliedInterval == null
                    ? "—"
                    : `${snap.appliedInterval} ms`}
                </b>
              </span>
              <span>
                端到端耗时{" "}
                <b>
                  {mode === "jev" && snap?.e2eLatency
                    ? `${snap.e2eLatency} ms`
                    : "—"}
                </b>
              </span>
              <span>
                本地避险 <b>{snap?.reflexCount || 0} 次</b>
              </span>
              <span>
                丢弃过期决策 <b>{snap?.discarded || 0} 次</b>
              </span>
            </div>
          </section>
          <section className="panel">
            <div className="panel-title">
              <span>战场导演</span>
              <span className="eyebrow">DIRECTOR</span>
            </div>
            <p className="director-state">
              <span>✦</span> {snap?.director || "等待战场开始"}
            </p>
            <div className="arsenal">
              {(["machine", "laser", "mine"] as const).map((w) => (
                <div
                  key={w}
                  title={
                    w === "machine"
                      ? "24 发快速射击"
                      : w === "laser"
                        ? "4 次蓄力激光，命中造成 2 点伤害"
                        : "3 枚地雷，1 秒后武装，双方都能触发"
                  }
                >
                  <span style={{ color: WEAPONS[w].color }}>
                    {WEAPONS[w].icon}
                  </span>
                  <small>{WEAPONS[w].name}</small>
                </div>
              ))}
            </div>
            <p className="subtle">
              导演决定投放，双方自由争夺。
              <br />
              地雷拾取后，点击开火部署。
            </p>
          </section>
          <section className="panel feed-panel">
            <div className="panel-title">
              <span>战场动态</span>
              <span className="eyebrow">
                {mode === "jev" ? `${snap?.calls || 0} CALLS` : "LOCAL"}
              </span>
            </div>
            <div className="feed" aria-live="polite">
              {snap?.logs.length ? (
                snap.logs.slice(0, 8).map((l) => (
                  <div className="feed-item" key={l.id}>
                    <time>
                      {Math.floor(l.time / 60)
                        .toString()
                        .padStart(2, "0")}
                      :
                      {Math.floor(l.time % 60)
                        .toString()
                        .padStart(2, "0")}
                    </time>
                    <div>
                      <b>{l.role}</b> {l.text}
                      <small>{l.source}</small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="feed-empty">战场安静，等待第一个决定。</div>
              )}
            </div>
            <div className="token-count">
              {mode === "jev"
                ? `${(snap?.tokens || 0).toLocaleString()} tokens · 本场累计`
                : "练习数据不计入 Jev 调用"}
            </div>
          </section>
        </aside>
      </main>
      {snap?.error && (
        <div className="error" role="alert">
          {snap.error}{" "}
          <span>失效战术会停止；本地避险仍可工作，不会自动生成新战术。</span>
        </div>
      )}
      {help && (
        <div className="modal" onClick={() => setHelp(false)}>
          <div className="help" onClick={(e) => e.stopPropagation()}>
            <button
              className="close"
              onClick={() => setHelp(false)}
              aria-label="关闭说明"
            >
              ×
            </button>
            <span className="eyebrow">FIELD MANUAL</span>
            <h2>操控坦克，读懂对手。</h2>
            <p>
              WASD 或方向键移动。鼠标瞄准，按住左键或空格开火。P
              暂停，切出窗口自动暂停。
            </p>
            <p>
              每辆坦克 3 点生命，先得 5 分获胜。普通炮弹最多反弹 5
              次，反弹回来的己方炮弹也会造成伤害。
            </p>
            <p>
              机关枪快速连射；激光炮蓄力 0.65 秒后造成 2 点伤害；地雷部署 1
              秒后武装，爆炸会伤到双方。
            </p>
            <p>
              Jev
              选择战术和道具投放；本地控制器持续瞄准、计算反弹弹道，并对迫近的危险紧急闪避。面板单独标明本地反射。置信度不是胜率。
            </p>
            <button className="primary" onClick={() => setHelp(false)}>
              准备好了
            </button>
          </div>
        </div>
      )}
      <footer>
        <span>
          JEV ARENA <i>/</i> EXPERIMENT 001
        </span>
        <span>Built for human curiosity.</span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
