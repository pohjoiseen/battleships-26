# The original's AI, straight from the Z80

Tools for studying the computer player of the original _Battle Ships_ (Hit-Pak / Elite, 1987)
and checking our port of it (`packages/server/src/ai/original/`) against the real code. The
annotated disassembly is in `docs/original-ai.asm`.

Needs Python 3 with [SkoolKit](https://skoolkit.ca/) 10:

```sh
python -m venv .venv && .venv/bin/pip install skoolkit
.venv/bin/python snapshot.py      # downloads the tape, writes .cache/boot.z80 and .cache/game.z80
.venv/bin/python fixtures.py 1500 # runs the AI on random situations -> fixtures.json.gz
```

- `zx.py`: a small scriptable Spectrum on SkoolKit's simulator: run frames, hold keys, save
  snapshots and screenshots.
- `snapshot.py`: loads the tape (the Uni-Loader reads standard-speed blocks with flag bytes
  $80..$8A, then moves the code up and jumps to $8000) and starts a one-player game.
  Keys in the game: `2`/`W` up/down, `9`/`0` sideways, `M` select; menu `2` for one player,
  `1` to start.
- `fixtures.py`: for each case, writes a board, a plan and the AI's variables into memory, calls
  $A722 (pick a target) with interrupts off, and records the target and the variables after.
  Also records $A3FD (fleet placement) for random seeds. It prints the AI instructions no case
  reached; the few left are unreachable (carries that never happen, the code after the bug at
  $9B88) or very rare (the cruiser search running all 50 rounds).

Handy addresses: boards at $6100 (player 1) and $6300 (player 2), 20x20 bytes, row 0 at the
top; $A4D8 points at the board being shot at; $FD58 is the player on turn (1 = computer in a
one-player game). NOPing the `JP NZ` at $A6EA lets the computer play both sides.
