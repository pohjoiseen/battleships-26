"""Tiny scriptable Spectrum harness on SkoolKit's C simulator."""
from skoolkit import CSimulator
from skoolkit.simutils import from_snapshot, get_state, T, PC
from skoolkit.snapshot import Snapshot, write_snapshot
from skoolkit.graphics import Frame, scr_udgs
from skoolkit.components import get_image_writer

ROWS = ['CS Z X C V', 'A S D F G', 'Q W E R T', '1 2 3 4 5', '0 9 8 7 6', 'P O I U Y', 'EN L K J H', 'SP SS M N B']
KEYPOS = {k: (r, b) for r, row in enumerate(ROWS) for b, k in enumerate(row.split())}
FRAME = 69888


class Tracer:
    def __init__(self):
        self.pressed = set()
        self.border = 0
        self.outfe = 0

    def read_port(self, registers, port):
        if port % 2 == 0:
            h = (port >> 8) ^ 0xFF
            v = 0
            for k in self.pressed:
                r, b = KEYPOS[k]
                if h & (1 << r):
                    v |= 1 << b
            return (~v) & 0xFF
        return 0xFF

    def write_port(self, registers, port, value, offset=0):
        if port % 2 == 0:
            self.border = value & 7
            self.outfe = value


class ZX:
    def __init__(self, path):
        snap = Snapshot.get(path)
        self.sim = from_snapshot(CSimulator, snap, {}, {}, {'fast_djnz': False, 'fast_ldir': False})
        self.tracer = Tracer()
        self.sim.set_tracer(self.tracer)
        self.mem = self.sim.memory
        self.reg = self.sim.registers
        self.exec_map = set()

    @property
    def t(self):
        return self.reg[T]

    @property
    def pc(self):
        return self.reg[PC]

    def run(self, frames=1, stop=-1, keys=(), max_ops=0):
        """Run for `frames` frames (or until PC == stop). Returns True if stopped at `stop`."""
        self.tracer.pressed = set(keys)
        end = self.t + int(frames * FRAME)
        cond, _ = self.sim.trace(self.pc, stop, max_ops, end, 1, None, self.exec_map, None, None, None)
        return cond == 3

    def step_until(self, stop, frames=5000, keys=()):
        return self.run(frames, stop, keys)

    def tap(self, key, hold=3, after=10):
        self.run(hold, keys=[key] if isinstance(key, str) else key)
        self.run(after)

    def png(self, fname, scale=2):
        scr = scr_udgs(self.mem, 0, 0, 32, 24)
        with open(fname, 'wb') as f:
            get_image_writer().write_image([Frame(scr, scale)], f)

    def save(self, fname):
        ram, registers, state, machine = get_state(self.sim)
        write_snapshot(fname, ram, registers, state, machine)

    def peek(self, a, n=1):
        return list(self.mem[a:a + n]) if n > 1 else self.mem[a]

    def word(self, a):
        return self.mem[a] | self.mem[a + 1] << 8
