# Battleships

A browser remake of the ZX Spectrum game _Battle Ships_ (Hit-Pak, 1987). See [SPEC.md](SPEC.md) for
the idea and the original game.

## Running it

```sh
npm install
npx playwright install chromium   # once, for the end-to-end tests

npm run dev          # server on :3000 + Vite on :5173 — open http://localhost:5173
npm run build        # build the client into packages/client/dist
npm start            # production: the server serves the built client on :3000
```

Server environment variables: `PORT` (3000), `HOST` (127.0.0.1), `BS_TIME_SCALE` (1; scales the
salvo animation and AI pacing, the tests use 0.05), `BS_SEED` (makes games reproducible).

## Checks

```sh
npm test             # unit + server integration tests (Vitest)
npm run test:e2e     # browser tests (Playwright): full 1P and 2P games, placement, refresh
npm run typecheck
npm run lint
```

## Layout

- `packages/shared`: the rules, used by the server (authoritative) and the client (instant
  feedback). `game.ts` is a pure state machine; `views.ts` makes the per-player view, which never
  contains the opponent's ship positions; `protocol.ts` holds the WebSocket messages.
- `packages/server`: Fastify + WebSocket. `sessions.ts` handles game creation, player tokens and
  single-use invite links; `room.ts` runs one game, paces the salvo animation and the AI.
  `ai/simple.ts` is the probability-density AI.
- `packages/client`: `index.html` is the menu; `game.html` is one canvas drawn at 400x300 and
  scaled up with crisp pixels. The graphics are placeholders until the art milestone.
- `e2e`: Playwright specs. The game page exposes `window.__bs` so tests can find cells on the canvas.

## Rules as implemented

Checked against the original (playthrough video in `zx-screenshots/`) where the spec left gaps:

- 20x20 sea; carrier (Z shape), cruiser 5, submarine (T), 2 destroyers 3, torpedo boat 2.
- Ships rotate but never mirror. Straight ships may also lie on either diagonal. The carrier's Z
  looks the same after a half turn, so it has two orientations.
- Ships may not touch, not even at a corner.
- Placement starts from a random layout; both players place at the same time.
- 4 shots per surviving ship (salvo fire), or always 4 per turn with salvo fire off. All shots in a
  salvo resolve together; no cells are marked automatically around sunk ships.
- The first player is picked at random.
- The salvo animation shows which ship each hit struck, in shuffled order, so it doesn't reveal
  which cell hit which ship.
- As in the original, your own ships aren't shown while the opponent is aiming at your sea.
