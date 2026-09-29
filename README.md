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
salvo animation and AI pacing, the tests use 0.05), `BS_SEED` (makes games reproducible),
`BS_AIS` (the computer players offered, from `original,simple,strong`; all by default. ACE,
`strong`, takes about 0.1-0.5 s of CPU per turn, so a small server may want `original,simple`).

## Checks

```sh
npm test             # unit + server integration tests (Vitest)
npm run test:e2e     # browser tests (Playwright): full 1P and 2P games, placement, refresh
npm run typecheck
npm run lint
npm run logo         # regenerate packages/client/public/logo.svg from scripts/make-logo.ts
```

## Layout

- `packages/shared`: the rules, used by the server (authoritative) and the client (instant
  feedback). `game.ts` is a pure state machine; `views.ts` makes the per-player view, which never
  contains the opponent's ship positions; `protocol.ts` holds the WebSocket messages.
- `packages/server`: Fastify + WebSocket. `sessions.ts` handles game creation, player tokens and
  single-use invite links; `room.ts` runs one game, paces the salvo animation and the AI. `ai/`
  has the computer players (see below).
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
- 4 shots per surviving ship (salvo fire), or always 4 per turn with salvo fire off. Placing the
  last shot of a turn fires the salvo (there's no FIRE button, as in the original). All shots in a
  salvo resolve together; no cells are marked automatically around sunk ships.
- The first player is picked at random.
- The salvo animation shows which ship each hit struck, in shuffled order, so it doesn't reveal
  which cell hit which ship.
- As in the original, your own ships aren't shown while the opponent is aiming at your sea.

## The computer player

The menu's COMPUTER option picks the opponent in one-player games: **1987**, the original's own AI;
**2026**, our probability-density AI (`ai/simple.ts`); or **ACE**, our Monte Carlo AI
(`ai/strong.ts`). ACE samples whole fleets that fit everything it has seen, picks salvos that find
the most ships while finishing damaged ones, and looks ahead by playing candidate salvos out to the
end of the game in some of those fleets. Neither of ours cheats.

The original's is ported instruction by instruction from the tape
(`packages/server/src/ai/original/machine.ts`) and tested against the real Z80 code run in an
emulator; `docs/original-ai.asm` is its annotated disassembly and `scripts/original-ai/` has the
tools. It keeps all its habits:

- It hunts in lines while much of the sea is untouched (the diagonal streaks of its first salvos),
  then in 5x5 blocks, a short random walk in the block with the fewest shots.
- It cheats: every 29 hunting shots it looks at your fleet and shoots an unhit ship cell, and it
  always knows which of its hits belong to which ship. It finishes off the smallest damaged ship
  first, and the carrier's last cell it simply looks up.
- It also cheats against itself: the first shot of each line is always open sea.
- Its bugs stay too, except one: once the 32 cells its random numbers can start a line from are
  used up, the original hangs for good (about one game in 60, computer against computer).

`npm run bench:ai` compares the AIs.

Sound effects are synthesised beeper-style (`gfx/sound.ts`); **M** toggles them on and off.
