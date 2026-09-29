"""Downloads the original tape and makes the snapshots the other scripts start from.

.cache/boot.z80  the game just after the loader has jumped to it ($8000)
.cache/game.z80  a one-player game, the computer about to aim its first salvo
"""
import io
import os
import subprocess
import sys
import urllib.request
import zipfile

from zx import ZX

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')
TAPE_URL = 'https://spectrumcomputing.co.uk/pub/sinclair/games/b/BattleShips.tzx.zip'
TAPE = os.path.join(CACHE, 'Battleships.tzx')


def tool(name):
    return os.path.join(os.path.dirname(sys.executable), name)


def main():
    os.makedirs(CACHE, exist_ok=True)
    if not os.path.exists(TAPE):
        with urllib.request.urlopen(TAPE_URL) as r:
            with zipfile.ZipFile(io.BytesIO(r.read())) as z:
                name = next(n for n in z.namelist() if n.lower().endswith('.tzx'))
                open(TAPE, 'wb').write(z.read(name))
    loaded = os.path.join(CACHE, 'loaded.z80')
    boot = os.path.join(CACHE, 'boot.z80')
    # the loader reads the game in 4K blocks, then moves it up and jumps to $8000
    subprocess.run([tool('tap2sna.py'), '-c', 'finish-tape=1', TAPE, loaded], check=True,
                   stdout=subprocess.DEVNULL)
    subprocess.run([tool('trace.py'), '-S', '0x8000', loaded, boot], check=True,
                   stdout=subprocess.DEVNULL)

    z = ZX(boot)
    z.run(100)
    z.tap('SP', 5, 50)  # title -> menu
    z.tap('2', 5, 50)  # 1 PLAYER
    z.tap('1', 5, 200)  # START: player 1 places ships
    z.run(10)
    for _ in range(3):  # up to END
        z.run(4, keys=['2'])
        z.run(4)
    z.tap('M', 4, 10)
    z.save(os.path.join(CACHE, 'game.z80'))
    print('wrote', os.path.join(CACHE, 'game.z80'))


if __name__ == '__main__':
    main()
