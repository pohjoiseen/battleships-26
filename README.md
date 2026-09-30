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
`strong`, takes about 0.1-0.5 s of CPU per turn, so a small server may want `original,simple`),
`BS_DB` (the SQLite file games are saved in, so they survive a restart; `data/battleships.db` by
default, `:memory:` to keep nothing). Games nobody has touched for a day are dropped.

## Deploying

On a Linux server with systemd and nginx (written for Ubuntu 24.04): the game runs as its own
user, with Node 26 from [nvm](https://github.com/nvm-sh/nvm) (Ubuntu's Node is too old), behind
nginx, which does HTTPS. [deploy/](deploy) has the systemd unit and the nginx site; they assume
the user `battleships`, the checkout `/home/battleships/battleships-26`, port 3026 and the domain
bs26.pohjoiseen.fi.

```sh
# a user for the game, with Node
sudo useradd --create-home --shell /bin/bash battleships
sudo -iu battleships
# install nvm with the line from its README, then log out and in again
nvm install 26
ln -sfn "$(dirname "$(dirname "$(nvm which 26)")")" ~/node   # the service runs ~/node/bin/node

# the game: the repository is private, so give the server a read-only deploy key (GitHub: the
# repository's Settings > Deploy keys > Add, with the public key this prints)
ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
git clone git@github.com:pohjoiseen/battleships-26.git
# npm ci installs the build tools too; the server also runs through tsx
cd battleships-26 && npm ci && npm run build
exit

# the service, then nginx and the certificate (as the comments at the top of each file say)
sudo cp /home/battleships/battleships-26/deploy/battleships.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now battleships
sudo cp /home/battleships/battleships-26/deploy/nginx.conf \
  /etc/nginx/sites-available/bs26.pohjoiseen.fi
sudo ln -s ../sites-available/bs26.pohjoiseen.fi /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d bs26.pohjoiseen.fi   # sudo apt install certbot python3-certbot-nginx
```

The log is in `journalctl -u battleships` (JSON lines, one per request; tokens are left out).

To update: as `battleships`, `cd battleships-26 && git pull && npm ci && npm run build`, then
`sudo systemctl restart battleships`. Games in progress carry on after the restart. For a newer
Node, `nvm install` it, point `~/node` at it as above, and restart.

Games and hi-scores are in `/var/lib/battleships/battleships.db`. To back it up while the server
runs: `sudo sqlite3 /var/lib/battleships/battleships.db ".backup /some/where/battleships.db"`.

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
