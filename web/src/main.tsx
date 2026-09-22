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
  if (!r.ok) throw new Error(data.error || "Service unavailable");
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
    if (mode !== "practice" && !health?.configured) return;
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
        <a className="brand" href="/" aria-label="Jev Arena home">
          <span className="mark">
            J<span>·</span>
          </span>
          <div>
            JEV<span className="brand-light"> ARENA</span>
            <small>Human instinct versus machine judgment.</small>
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
              ? "LOCAL PRACTICE · NO JEV"
              : health?.configured
                ? snap?.calls
                  ? "JEV CONNECTED"
                  : "JEV CONFIGURED"
                : healthError
                  ? "SERVICE OFFLINE"
                  : "JEV NOT CONFIGURED"}
          </span>
          <button
            className="icon-button"
            onClick={() => setHelp(!help)}
            aria-label="How to play"
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
                A DUEL THAT THINKS<span> / 01</span>
              </h1>
            </div>
            <span className="round">
              ROUND {String(snap?.round || 1).padStart(2, "0")} <b>·</b> FIRST TO 5
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
                <strong>{mode !== "practice" ? "JEV" : "LOCAL"}</strong>
                <span className="tank-dot orange">▰</span>
              </div>
            </div>
            <div className="canvas-wrap">
              <canvas
                ref={canvas}
                aria-label="Tank arena. Move with WASD, aim with the mouse, click to fire."
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
                          ? "NEXT ROUND INCOMING"
                          : snap && snap.time > 0
                            ? "BATTLE PAUSED"
                            : "YOUR INSTINCT. ITS JUDGMENT.")} 
                    </h2>
                    <p>
                      {snap?.roundOver
                        ? "Tanks redeploy. The score carries over."
                        : mode === "practice"
                          ? "Fight a local rules opponent with random pickups."
                          : "Drive the green tank against the Jev-controlled orange tank."}
                    </p>
                    {!snap?.roundOver && (
                      <button
                        className="primary"
                        disabled={!ready && !snap?.winner}
                        onClick={snap?.winner ? restart : start}
                      >
                        {snap?.winner
                          ? "PLAY AGAIN"
                          : snap && snap.time > 0
                            ? "RESUME →"
                            : "ENTER ARENA →"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="arena-footer">
              <span>
                <i className="legend-dot green" /> PLAYER{" "}
                <i className="legend-dot orange" />{" "}
                {mode !== "practice" ? "JEV OPPONENT" : "LOCAL OPPONENT"}
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
                SHOW AI PATHS
              </label>
              <span>RICOCHETS CAN HIT THEIR OWNER</span>
            </div>
          </div>
          <div className="controls">
            <div className="key-guide">
              <span>
                <kbd>W</kbd>
                <kbd>A</kbd>
                <kbd>S</kbd>
                <kbd>D</kbd> MOVE
              </span>
              <span>
                <kbd>↖</kbd> MOUSE AIM
              </span>
              <span>
                <kbd>CLICK</kbd> FIRE / MINE
              </span>
            </div>
            <div className="actions">
              <button onClick={restart}>↻ RESTART</button>
              <button
                className="primary small"
                disabled={!ready || !!snap?.winner}
                onClick={start}
              >
                {snap?.running ? "Ⅱ PAUSE" : "▶ START"}
              </button>
            </div>
          </div>
          <div className="bottom-note">
            <span>01 / PROBE. FLANK. CLAIM WEAPONS.</span>
            <span>EVERY PATH IS A DECISION.</span>
          </div>
        </section>
        <aside>
          <section className="panel connection">
            <div className="panel-title">
              <span>DECISION ENGINE</span>
              <span className="eyebrow">ENGINE</span>
            </div>
            <div className="mode-switch">
              <button
                className={mode === "direct" ? "active" : ""}
                onClick={() => changeMode("direct")}
              >
                JEV DIRECT
              </button>
              <button
                className={mode === "jev" ? "active" : ""}
                onClick={() => changeMode("jev")}
              >
                JEV TACTICAL
              </button>
              <button
                className={mode === "practice" ? "active" : ""}
                onClick={() => changeMode("practice")}
              >
                LOCAL PRACTICE
              </button>
            </div>
            {mode !== "practice" && !health?.configured ? (
              <div className="setup">
                <strong>
                  {healthError ? "LOCAL SERVICE OFFLINE" : "CONNECT JEV"}
                </strong>
                <p>
                  {healthError
                    ? "Make sure npm run dev is running."
                    : "Set TYPESAFE_API_KEY in the project .env file, then restart. The key stays on the server."}
                </p>
                <button onClick={refresh}>↻ CHECK CONNECTION</button>
              </div>
            ) : (
              <p className="subtle">
                {mode === "practice"
                  ? "Rules AI with random pickups. No Jev calls or simulated Jev output."
                  : mode === "direct"
                    ? `${health?.model} · Direct controls, no auto-aim or auto-dodge`
                    : `${health?.model} · Jev tactics with local reflexes`}
              </p>
            )}
          </section>
          <section className="panel">
            <div className="panel-title">
              <span>
                <i className="legend-dot orange" /> OPPONENT STATUS
              </span>
              <span className={"pulse " + (snap?.pending ? "thinking" : "")}>
                {snap?.pending ? "THINKING" : "LIVE"}
              </span>
            </div>
            <div className="intent">{snap?.plan || "WAITING FOR DECISION"}</div>
            <div className="combat-status">
              <span>{snap?.reflex || "MONITORING TRAJECTORIES"}</span>
              <span>{snap?.shotType || "AWAITING FIRE AUTHORIZATION"}</span>
            </div>
            {mode === "direct" && (
              <div className="subtle">
                <p>{snap?.controls}</p>
                <p>
                  INPUT AGE: {snap?.controlAge ?? "—"}ms ·{" "}
                  {snap?.pending ? "REQUESTING" : "AWAITING NEXT OBSERVATION"}
                </p>
                <button
                  onClick={() => {
                    const data = JSON.stringify(
                      game.current?.directTrace,
                      null,
                      2,
                    );
                    const url = URL.createObjectURL(
                      new Blob([data], { type: "application/json" }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "jev-controls.json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  EXPORT LAST 200 CONTROL RECORDS
                </button>
                <p>
                  Timeouts do not pause the game. Inputs release after 1.8
                  seconds. Confidence comes from one complete control choice.
                </p>
              </div>
            )}
            <div className="weapon-line">
              <span>CURRENT WEAPON</span>
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
                  {mode !== "practice" && snap?.latency
                    ? `${snap.latency}`
                    : "—"}
                  <small> ms</small>
                </b>
                <span>LAST CALL</span>
              </div>
              <div>
                <b>
                  {mode !== "practice" && snap?.confidence != null
                    ? `${Math.round(snap.confidence * 100)}%`
                    : "—"}
                </b>
                <span>CHOICE CONFIDENCE</span>
              </div>
            </div>
            <div className="combat-telemetry">
              <span>
                TARGET INTERVAL <b>{snap?.cadence || 900} ms</b>
              </span>
              <span>
                APPLIED INTERVAL{" "}
                <b>
                  {snap?.appliedInterval == null
                    ? "—"
                    : `${snap.appliedInterval} ms`}
                </b>
              </span>
              <span>
                END-TO-END LATENCY{" "}
                <b>
                  {mode !== "practice" && snap?.e2eLatency
                    ? `${snap.e2eLatency} ms`
                    : "—"}
                </b>
              </span>
              <span>
                {mode === "direct" ? "CONTROL CANDIDATES" : "LOCAL DODGES"}{" "}
                <b>
                  {mode === "direct"
                    ? `${snap?.candidateCount || 0}`
                    : `${snap?.reflexCount || 0}`}
                </b>
              </span>
              <span>
                STALE DECISIONS <b>{snap?.discarded || 0}</b>
              </span>
            </div>
          </section>
          <section className="panel">
            <div className="panel-title">
              <span>ARENA DIRECTOR</span>
              <span className="eyebrow">DIRECTOR</span>
            </div>
            <p className="director-state">
              <span>✦</span> {snap?.director || "WAITING FOR BATTLE"}
            </p>
            <div className="arsenal">
              {(["machine", "laser", "mine"] as const).map((w) => (
                <div
                  key={w}
                  title={
                    w === "machine"
                      ? "24 rapid-fire rounds"
                      : w === "laser"
                        ? "4 charged lasers; 2 damage on hit"
                        : "3 mines; arm after 1 second; damage either tank"
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
              The director places pickups for either tank to claim.
              <br />
              Click fire to deploy a collected mine.
            </p>
          </section>
          <section className="panel feed-panel">
            <div className="panel-title">
              <span>BATTLE FEED</span>
              <span className="eyebrow">
                {mode !== "practice" ? `${snap?.calls || 0} CALLS` : "LOCAL"}
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
                <div className="feed-empty">The arena is quiet. Waiting for the first decision.</div>
              )}
            </div>
            <div className="token-count">
              {mode !== "practice"
                ? `${(snap?.tokens || 0).toLocaleString()} TOKENS · MATCH TOTAL`
                : "PRACTICE DOES NOT CALL JEV"}
            </div>
          </section>
        </aside>
      </main>
      {snap?.error && (
        <div className="error" role="alert">
          {snap.error}{" "}
          <span>
            {mode === "direct"
              ? "The game continues. The last input remains active until it expires, then releases."
              : "The stale tactic stops. Local dodging remains active without inventing a new tactic."}
          </span>
        </div>
      )}
      {help && (
        <div className="modal" onClick={() => setHelp(false)}>
          <div className="help" onClick={(e) => e.stopPropagation()}>
            <button
              className="close"
              onClick={() => setHelp(false)}
              aria-label="Close instructions"
            >
              ×
            </button>
            <span className="eyebrow">FIELD MANUAL</span>
            <h2>Drive your tank. Read your opponent.</h2>
            <p>
              Move with WASD or the arrow keys. Aim with the mouse. Hold the
              left button or Space to fire. Press P to pause. Switching windows
              pauses automatically.
            </p>
            <p>
              Each tank has 3 health. First to 5 points wins. Standard shells
              can bounce up to 5 times and can hit their owner.
            </p>
            <p>
              The machine gun fires rapidly. The laser charges for 0.65 seconds
              and deals 2 damage. Mines arm after 1 second and can damage either
              tank.
            </p>
            <p>
              In Direct mode, Jev chooses complete movement, aim, and fire
              controls with no combat assistance. Tactical mode keeps local
              aiming and emergency dodging. The Jev director places pickups in
              both modes. Confidence is not a win probability.
            </p>
            <button className="primary" onClick={() => setHelp(false)}>
              READY
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
