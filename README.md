# Jev Tank Arena

[English](README.md) | [简体中文](README.zh-CN.md)

A browser-based tank battle where you fight an AI-controlled opponent powered by Jev.

You control the green tank. Jev controls the orange tank and can also act as the arena director, deciding when and where weapon pickups appear. The game combines AI decisions with deterministic local physics, pathfinding, trajectory prediction, and collision detection.

## Features

- Fast Canvas 2D tank combat
- Random, reachable spawn positions
- Bouncing shells that can hit their owner
- Machine guns, lasers, and mines
- A* pathfinding and live trajectory prediction
- Jev decision probabilities shown in the arena
- Three modes for comparing AI and local control
- Decision trace export for debugging

## Game Modes

- **Jev Direct** — Jev chooses complete movement, aim, and fire actions.
- **Jev Tactical** — Jev chooses tactics while local systems handle aiming and emergency dodging.
- **Local Practice** — Runs without an API key using rule-based behavior.

Jev requests are asynchronous. Slow or failed responses never pause the game, and stale decisions are discarded.

## Getting Started

Requirements:

- Node.js 22 or later
- A TypeSafe API key for the Jev modes

```sh
nvm use
npm install
cp .env.example .env
```

Add your API key to `.env`:

```env
TYPESAFE_API_KEY=your_api_key
TYPESAFE_MODEL=jev-latest
PORT=3001
```

Start the frontend and backend together:

```sh
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

The API key stays on the server and is never sent to the browser. Local Practice works without a key.

## Controls

| Action | Control |
| --- | --- |
| Move | `WASD` or arrow keys |
| Aim | Mouse |
| Fire | Left mouse button or `Space` |
| Pause | `P` |

Each tank has three health points. The first tank to score five points wins.

## Technology

- React and TypeScript
- Canvas 2D
- Vite
- Node.js and Fastify
- TypeSafe SDK and Jev

## Commands

```sh
npm run dev        # Start the development server and web app
npm test           # Run the test suite
npm run build      # Type-check and create a production build
npm start          # Serve the production build on 127.0.0.1:3001
npm run benchmark  # Run the offline combat benchmark
npm run verify:jev # Make live Jev verification calls (uses API credits)
```

## How Jev Controls the Tank

The game sends Jev a compact observation of the arena plus a list of valid control candidates. Each candidate combines movement, a semantic aim mode, and whether to fire. Candidates include predicted movement, wall clearance, danger, and verified shot trajectories.

Jev returns a typed choice and a probability distribution. The game applies the selected action for a limited time while continuing to simulate physics locally. Invalid, unsafe, late, or outdated actions are rejected.

## License

MIT
