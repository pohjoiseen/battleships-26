# Battleships 26

This is a browser remake of the ZX Spectrum game _Battle Ships_ (by Hit-Pak / Elite, 1987).  This used
to be one of my favorite games when I was a kid; it is a rather nice variation on the classic Battle Ships,
on a 20x20 board, with 6 ships, up to 24 shots per turn, and also cool salvo animations.
**This is an unofficial fan remake, not affiliated with Hit-Pak, Elite Systems or Keith Burkhill, the original author.**
It tries to keep the gameplay as close to the original as possible, and keep the spirit of the visuals, but everything has been
recreated anew.  The one exception is the original computer AI from 1987 version, which was reverse engineered
(see `docs/original-ai.asm`), and ported to TypeScript, although there are two other unrelated AIs present.

**This project is also entirely vibe-coded by Claude Opus 5.5 medium.**  In fact, this is the first non-trivial
vibe-coded project that I've ever done.  The only things I wrote by hand were the initial "spec" and parts of
this README.  I did, however, read the code; I find no serious issues with it, although I've never made such games
before and I might conceivably miss something important.  It wasn't created from a single prompt, rather
incrementally, taking about four evenings and 87$ in equivalent API costs (in reality make like 20% of a weekly limit of
a Max x5 subscription).  It did require some back-and-forth about visual and sound aspects, with Claude
screenshotting results with headless Chromium and clearly often missing some details (and sound it was unable
to evaluate at all), but code was generally good from the get go.

The game is written in TypeScript.  The server part uses Fastify server/framework for NodeJS.  It keeps games and high scores
in a sqlite database for persistence across restarts.  (Database part does not currently have any kind of migrations.)
The client doesn't rely on any frameworks, it renders into an offscreen 400x300 canvas, upscaled into the viewport,
keeping the pixelated appearance.  The overall client bundle is just a bit over 160 KB, and gzipped would be on the
same scale as the original Spectrum _Battle Ships_.  Realtime communication between the client and the server is over
websockets (commands go up, updated state goes down).  Client survives disconnects and page reloads, game sessions have a
random session key in their URLs; no registration etc. needed.

It was quite amazing how well Claude can compensate for being about to input only text or still images,
and output just text.  I fed it a playthrough video pre-downloaded from YouTube, this one I believe: https://www.youtube.com/watch?v=1OQ3AWLtMrY.
Claude took it apart by frames with ffmpeg and used that to figure out various nuances of the game and the general
idea of the salvo animation.  To reproduce sound effects similar to the original, it generated spectrograms
and waveforms of the sounds from the video, and read the resulting images.  For ships, I requested it make player 1
(red) more explicitly USSR and player 2 (yellow) the US.  Well, yellow doesn't quite fit as the US, but I wanted to keep
the general color scheme.  It then based ship graphics on, supposedly, actual historical ship designs from the USSR
and the US, e.g, the aircraft carriers are _Kiev_-class (=_Кречет_, Project 1143) and _Nimitz_-class.  Although not all of
them are all that similar to the supposed originals, Claude was clearly working from memory here.  Overall all graphics
and sound effects are created entirely procedurally, so there are explicit calls of "draw box", "draw arc" etc.
for every ship type etc.  But it does of course render them into cached sprites/audio buffers on first use, instead of
redrawing from scratch.  Overall I would say the visuals have more, let's say, "16-bit"/"DOS" vibes than the original
8-bit ones.

There are three computer AIs.  **1987** is the original reverse-engineered version, with some original bugs kept in,
except for a rare lockup bug fixed (real, I remember hitting it with the real game as a kid).  It is a variation of the naive
random hunt + finish off AI.  It does actually cheat a bit in its favor to compensate for its simplicity, and generally
the result ends up pretty well-balanced.  The reverse-engineering was done by Claude without any other input from me.  It picked
the correct tools (https://github.com/skoolkid/skoolkit) and knew how it use it to extract the relevant subroutine,
I believe it actually was even running it under these tools to compare against the reverse-engineered version.

**2026** is the initial version of computer AI, a pretty simple one (just about 50 lines of code), which picks cells
based on the probability that a ship can be placed into them.  It creates a characteristic "lattice" pattern of missed
shots by endgame.  It is surprisingly strong, and generally beats me in at least 3/4 cases -- pretty much unless
I get lucky with hitting multiple ships early on.  **ACE** is the AI that Claude came up with when I asked it to "do its best",
it uses Monte Carlo search.  Took a lot of tokens and time, but in the end it is not drastically better than 2026,
in fact it makes some rather odd choices sometimes, and it uses quite a bit more CPU so it is disabled in the version
I deployed publicly.  However, Claude did add a benchmark, playing AIs against each other many hundreds of times,
and according to those it should indeed be better than 2026.  Claude's next idea was trying to learn from
the player's habits, we didn't go quite as far.

Among things missing in the original: mobile/portrait layout (not perfect, but works okayish, and also uses a "loupe"
view on mobile to place shots more precisely), "victory sail past" animation after game over (the original just had
surviving ships rush across the screen, unrolling high scores, Claude did pretty much come with this version yourself),
main menu animation (also pretty much Claude's idea).

I asked Claude to add unit tests wherever it actually makes sense, and E2E tests for the full game.  Which it did,
and the tests look sensible to me, that is, they don't seem to test for useless things.

In general I got the impression that Opus 5.5 is really pretty much the first model that just "gets it", although
my experience with previous models was fairly limited.  I didn't have to mess around with skills or subagents or anything
else of the sort, just prompting and checking what it did.  The whole experience was amazingly cool, scary and
kind of sad at the same time.

But of course, this is still a pretty simple project in the end, 8.3k lines of TypeScript.

The rest of this README is mostly the normal stuff about running the project etc., by Claude.


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

[deploy/](deploy) has an example systemd unit and the nginx site; they assume
the user `battleships`, the checkout `/home/battleships/battleships-26`, port 3026 and the domain
bs26.pohjoiseen.fi.  Could be deployed like that:

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

This is an example production configuration only, things don't have to be arranged in these particular
ways.

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

Checked against the original (playthrough video in `zx-screenshots/`, not committed into repo) where the spec left gaps:

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

Written by Claude Opus 5.5 Medium and Alexander Ulyanov.