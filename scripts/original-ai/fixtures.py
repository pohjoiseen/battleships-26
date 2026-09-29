"""Runs the original AI's routines on random situations and records what they do.

The results are the test fixture for the TypeScript port (packages/server/src/ai/original):
  $A722  pick a target (one call of the per-frame routine when it has no target)
  $A3FD  place the computer's fleet

Usage: python fixtures.py [cases] [seed]   (after snapshot.py)
"""
import gzip
import json
import os
import random
import sys

from skoolkit.simutils import A, IYh, IYl, PC, SP

from zx import ZX

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT = os.path.join(HERE, '.cache', 'game.z80')
OUT = os.path.join(HERE, '..', '..', 'packages', 'server', 'src', 'ai', 'original', 'fixtures.json.gz')

BOARD = 0x6100  # player 1's sea, which the computer aims at
ENEMY_BOARD = 0x6300
RETURN = 0x8000  # never reached from the AI code: a safe place to stop
SIZES = [0, 6, 5, 4, 3, 3, 2]
PEEK_INTERVAL = 29

# variables (see machine.ts)
FD = {name: 0xFD00 + off for name, off in dict(
    peek=0x35, blockShots=0xEA, block=0xEB, blockRow=0xEC, blockCol=0xED, lineMode=0xF3,
    lineDir=0xF4, anchorE=0xEE, anchorD=0xEF, target=0xCB, targetD=0xCC, ships=0xAD,
    torpedo=0x68, interval=0xFE, flags=0x23).items()}
HIT_OFFSET = 0xA810
RESUME = 0xAA26
CURSOR = 0xA14A
PLANNED = 0xFA65
RNG = 0xFD07


def mark_addr(ship):
    return 0xFDCD + 4 * (6 - ship) + 3


def board_str(b):
    out = []
    for v in b:
        if v == 0:
            out.append('.')
        elif v == 0xFF:
            out.append('x')
        elif v & 0x80:
            out.append('abcdef'[(v & 0x7F) - 1])
        else:
            out.append(str(v))
    return ''.join(out)


class Machine:
    def __init__(self):
        self.z = ZX(SNAPSHOT)
        self.sp = self.z.reg[SP]

    def call(self, addr, a=None, limit=40_000_000):
        z = self.z
        sp = self.sp - 2
        z.mem[sp] = RETURN & 0xFF
        z.mem[sp + 1] = RETURN >> 8
        z.reg[SP] = sp
        z.reg[PC] = addr
        z.reg[IYh], z.reg[IYl] = 0xFD, 0x00
        if a is not None:
            z.reg[A] = a
        # no interrupts: the game's IM 2 handler must not touch anything meanwhile
        end = z.t + limit
        cond, _ = z.sim.trace(addr, RETURN, 0, end, 0, None, z.exec_map, None, None, None)
        return cond == 3

    def poke_word(self, a, v):
        self.z.mem[a] = v & 0xFF
        self.z.mem[a + 1] = (v >> 8) & 0xFF

    def set_rng(self, r):
        for i in range(4):
            self.z.mem[RNG + i] = (r >> (24 - 8 * i)) & 0xFF

    def get_rng(self):
        m = self.z.mem
        return (m[RNG] << 24) | (m[RNG + 1] << 16) | (m[RNG + 2] << 8) | m[RNG + 3]

    def place(self, rng):
        """$A3FD for player 2: returns the board."""
        m = self.z.mem
        for i in range(400):
            m[ENEMY_BOARD + i] = 0
        self.set_rng(rng)
        if not self.call(0xA3FD, a=1):
            raise RuntimeError('placement did not return')
        return list(m[ENEMY_BOARD:ENEMY_BOARD + 400])


def random_situation(r, layout):
    board = list(layout)
    style = r.random()
    density = r.choice([0, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7]) * r.random() * 1.5
    for i in range(400):
        if r.random() < density:
            board[i] = 0xFF if board[i] == 0 else board[i] | 0x80
    # damage a few ships properly: runs of hits along their cells
    for ship in range(1, 7):
        if r.random() < (0.5 if style < 0.7 else 0.1):
            cells = [i for i in range(400) if board[i] & 0x7F == ship and board[i] != 0xFF]
            k = r.randint(1, len(cells))
            for i in r.sample(cells, k):
                board[i] = ship | 0x80
            # open sea around them, shot sometimes
            for i in cells:
                for d in (-21, -20, -19, -1, 1, 19, 20, 21):
                    j = i + d
                    if 0 <= j < 400 and board[j] == 0 and r.random() < 0.3:
                        board[j] = 0xFF
    unshot = [i for i in range(400) if not board[i] & 0x80]
    n = r.choice([0, 0, 1, 2, 3, 5, 8, 12, 16, 20, 23])
    near = [i for i in unshot if any(0 <= i + d < 400 and board[i + d] & 0x80 and board[i + d] != 0xFF
                                     for d in (-21, -20, -19, -1, 1, 19, 20, 21))]
    planned = []
    for _ in range(min(n, len(unshot))):
        pool = near if near and r.random() < 0.5 else unshot
        c = r.choice(pool)
        if c not in planned:
            planned.append(c)
    return board, planned


def random_state(r, board, planned):
    unhit = [sum(1 for v in board if v == s) for s in range(7)]
    stale = r.random() < 0.3
    cell = lambda: (r.randrange(20), r.randrange(20))
    if planned and r.random() < 0.7:
        cursor = (planned[-1] % 20, planned[-1] // 20)
    else:
        cursor = (0, 0) if r.random() < 0.5 else cell()
    return {
        'rng': r.randrange(1, 1 << 32),
        'peekCountdown': 1 if r.random() < 0.2 else r.randint(2, PEEK_INTERVAL),
        'blockShots': r.randint(0, 12) if r.random() < 0.8 else 0,
        'block': r.randrange(16),
        'blockRow': r.randrange(5),
        'blockCol': r.randrange(5),
        'lineMode': r.choice([0, 1, 1, 0xFF]),
        'lineDir': r.randrange(8),
        'anchor': cell(),
        'hitOffset': -BOARD if stale else r.randrange(400),
        'resume': cell(),
        'shipMark': [0] + [0 if stale or r.random() < 0.5 else s for s in range(1, 7)],
        'cursor': cursor,
        'enemyShips': sum(1 for s in range(1, 7) if unhit[s] > 0),
        'enemyTorpedoCells': unhit[6],
    }


def pick_case(mach, board, planned, st):
    z = mach.z
    m = z.mem
    mach.poke_word(0xA4D8, BOARD)
    for i, v in enumerate(board):
        m[BOARD + i] = v
    a = PLANNED
    for c in planned:
        m[a], m[a + 1] = c % 20, c // 20
        a += 2
    m[a] = 0xFF
    m[CURSOR], m[CURSOR + 1] = st['cursor'][1], st['cursor'][0]
    m[FD['ships']] = st['enemyShips']
    m[FD['torpedo']] = st['enemyTorpedoCells']
    for k in ('blockShots', 'block', 'blockRow', 'blockCol', 'lineMode', 'lineDir'):
        m[FD[k]] = st[k]
    m[FD['peek']] = st['peekCountdown']
    m[FD['anchorE']], m[FD['anchorD']] = st['anchor'][1], st['anchor'][0]
    mach.poke_word(HIT_OFFSET, (BOARD + st['hitOffset']) & 0xFFFF)
    m[RESUME], m[RESUME + 1] = st['resume'][1], st['resume'][0]
    for s in range(1, 7):
        m[mark_addr(s)] = st['shipMark'][s]
    mach.set_rng(st['rng'])
    m[FD['target']] = 0xFF
    m[FD['interval']] = PEEK_INTERVAL
    m[FD['flags']] &= ~0x40 & 0xFF
    if not mach.call(0xA722):
        return None
    target = None if m[FD['target']] == 0xFF else [m[FD['targetD']], m[FD['target']]]
    after = {
        'rng': mach.get_rng(),
        'peekCountdown': m[FD['peek']],
        'blockShots': m[FD['blockShots']],
        'block': m[FD['block']],
        'blockRow': m[FD['blockRow']],
        'blockCol': m[FD['blockCol']],
        'lineMode': m[FD['lineMode']],
        'lineDir': m[FD['lineDir']],
        'anchor': [m[FD['anchorD']], m[FD['anchorE']]],
        'hitOffset': ((m[HIT_OFFSET] | m[HIT_OFFSET + 1] << 8) - BOARD + 0x8000) % 0x10000 - 0x8000,
        'resume': [m[RESUME + 1], m[RESUME]],
        'shipMark': [0] + [m[mark_addr(s)] for s in range(1, 7)],
    }
    return target, after


def main():
    cases = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1987
    r = random.Random(seed)
    mach = Machine()
    placements = []
    for _ in range(100):
        rng = r.randrange(1, 1 << 32)
        placements.append({'rng': rng, 'board': board_str(mach.place(rng)), 'rngAfter': mach.get_rng()})
    picks = []
    stuck = 0
    while len(picks) < cases:
        layout = mach.place(r.randrange(1, 1 << 32))
        board, planned = random_situation(r, layout)
        st = random_state(r, board, planned)
        res = pick_case(mach, board, planned, st)
        if res is None:
            stuck += 1
            continue
        target, after = res
        st = dict(st)
        cursor = st.pop('cursor')
        ships = st.pop('enemyShips')
        torpedo = st.pop('enemyTorpedoCells')
        picks.append({
            'board': board_str(board),
            'planned': [[c % 20, c // 20] for c in planned],
            'cursor': list(cursor),
            'enemyShips': ships,
            'enemyTorpedoCells': torpedo,
            'state': {**st, 'anchor': list(st['anchor']), 'resume': list(st['resume'])},
            'target': target,
            'after': after,
        })
    data = json.dumps({'placements': placements, 'picks': picks}, separators=(',', ':'))
    with gzip.GzipFile(OUT, 'wb', mtime=0) as f:  # no timestamp: same cases, same file
        f.write(data.encode())
    print(f'wrote {len(picks)} picks ({stuck} stuck skipped), {len(placements)} placements')
    seen = mach.z.exec_map
    missed = [a for a in instructions(mach.z.mem) if a not in seen]
    print('AI instructions never executed:', ' '.join(f'{a:04X}' for a in missed))


def instructions(mem):
    """Start addresses of the AI's instructions (for coverage)."""
    from skoolkit.traceutils import disassemble
    out = []
    # $9A0E and $ABF6 are an unused routine pair; $A7B0 is unused too; $A874 is a table
    for start, end in ((0x99E2, 0x9A0E), (0x9A30, 0x9BFA), (0xA722, 0xA7B0), (0xA7BC, 0xA874),
                       (0xA884, 0xABF6)):
        a = start
        while a < end:
            out.append(a)
            a += disassemble(mem, a)[1]
    return out


if __name__ == '__main__':
    main()
