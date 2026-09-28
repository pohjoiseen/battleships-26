import type { ShipClass } from '@bs/shared';

/**
 * Side-on pixel art for the ships, authored as drawing code. Player 1 sails a Soviet-looking
 * fleet and player 2 an American-looking one: both haze grey, told apart by a wide red or
 * yellow band on the hull and by their silhouettes.
 *
 * Sprites are indexed grids: each pixel is a palette key (see `Ink`), or 0 for transparent.
 * x runs from the stern (0) to the bow; y runs up from the waterline (row 0 is the first row
 * above the water).
 */

export type Faction = 'ussr' | 'usa';

/** Palette keys. The faction palette turns them into colours. */
export const Ink = {
  None: 0,
  Outline: 1,
  Dark: 2,
  Mid: 3,
  Light: 4,
  Highlight: 5,
  Band: 6,
  BandShade: 7,
  Black: 8,
  Hull2: 9,
  Deck: 10,
  White: 11,
  Scorch: 12,
  Ember: 13,
  FlagA: 14,
  FlagB: 15,
  FlagC: 16,
} as const;
export type Ink = (typeof Ink)[keyof typeof Ink];

export const INK_COUNT = 17;

export interface Sprite {
  w: number;
  h: number;
  /** Row-major, row 0 is the waterline row, so rows go upwards. */
  px: Uint8Array;
  /** Height of the hull at the waterline, so damage can sink it by a sensible amount. */
  hullH: number;
  /** Spots where hits show, one per cell of the ship, as [x, y] on the sprite. */
  hitSpots: [number, number][];
}

export const SPRITE_H = 34;

class Painter {
  readonly px: Uint8Array;
  /** Added to every y: after the hull is painted, the deck is raised by its extra freeboard. */
  oy = 0;
  constructor(
    readonly w: number,
    readonly h = SPRITE_H,
  ) {
    this.px = new Uint8Array(w * h);
  }

  get(x: number, y: number): Ink {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return Ink.None;
    return this.px[y * this.w + x] as Ink;
  }

  dot(x: number, y: number, c: Ink) {
    x = Math.round(x);
    y = Math.round(y + this.oy);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }

  rect(x: number, y: number, w: number, h: number, c: Ink) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.dot(x + i, y + j, c);
  }

  hline(x: number, y: number, w: number, c: Ink) {
    this.rect(x, y, w, 1, c);
  }

  vline(x: number, y: number, h: number, c: Ink) {
    this.rect(x, y, 1, h, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Ink) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) this.dot(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, c);
  }

  /** A superstructure block lit from the upper left: light face, darker right edge and top. */
  block(x: number, y: number, w: number, h: number, windows = false) {
    this.rect(x, y, w, h, Ink.Light);
    this.hline(x, y + h - 1, w, Ink.Highlight);
    this.vline(x + w - 1, y, h, Ink.Mid);
    if (windows && h >= 3) {
      for (let i = x + 1; i < x + w - 1; i += 2) this.dot(i, y + h - 2, Ink.Black);
    }
  }

  /** A block whose front (bow side) slopes back, like a bridge. */
  slopedBlock(x: number, y: number, w: number, h: number, slope: number, windows = false) {
    for (let j = 0; j < h; j++) {
      const cut = Math.floor((j * slope) / Math.max(1, h - 1));
      this.hline(x, y + j, w - cut, j === h - 1 ? Ink.Highlight : Ink.Light);
      this.dot(x + w - cut - 1, y + j, Ink.Mid);
    }
    if (windows && h >= 3) {
      const j = h - 2;
      const cut = Math.floor((j * slope) / Math.max(1, h - 1));
      for (let i = x + w - cut - 2; i >= x + w - cut - 7 && i > x; i -= 2)
        this.dot(i, y + j, Ink.Black);
    }
  }

  /** A gun turret; `dir` 1 points the barrel at the bow, -1 at the stern. */
  turret(x: number, y: number, dir: 1 | -1, barrel = 5, twin = false) {
    this.rect(x, y, 5, 2, Ink.Light);
    this.hline(x + 1, y + 2, 3, Ink.Light);
    this.dot(dir === 1 ? x : x + 4, y + 2, Ink.Mid);
    this.hline(x, y, 5, Ink.Mid);
    const bx = dir === 1 ? x + 5 : x - barrel;
    this.hline(bx, y + 1, barrel, Ink.Mid);
    if (twin) this.hline(bx, y + 2, barrel - 1, Ink.Dark);
  }

  /** A pole mast with a yard near the top. */
  mast(x: number, y: number, h: number, yard = 3) {
    this.vline(x, y, h, Ink.Dark);
    if (yard) this.hline(x - (yard >> 1), y + h - 3, yard, Ink.Dark);
  }

  /** A tapering lattice mast. */
  lattice(x: number, y: number, h: number, base: number) {
    for (let j = 0; j < h; j++) {
      const half = Math.max(0, Math.round((base / 2) * (1 - j / h)));
      this.dot(x - half, y + j, Ink.Dark);
      this.dot(x + half, y + j, Ink.Dark);
      if (j % 3 === 0) this.hline(x - half, y + j, half * 2 + 1, Ink.Dark);
      else if (half > 1) this.dot(x + ((j % 2) * 2 - 1) * (half - 1), y + j, Ink.Mid);
    }
  }

  /** A funnel with a black cap; `rake` leans it towards the stern. */
  funnel(x: number, y: number, w: number, h: number, rake = 0) {
    for (let j = 0; j < h; j++) {
      const off = -Math.floor((j * rake) / Math.max(1, h));
      this.hline(x + off, y + j, w, Ink.Mid);
      this.dot(x + off, y + j, Ink.Light);
      this.dot(x + off + w - 1, y + j, Ink.Dark);
    }
    const off = -Math.floor(((h - 1) * rake) / Math.max(1, h));
    this.hline(x + off, y + h - 1, w, Ink.Black);
  }

  disc(cx: number, cy: number, r: number, c: Ink, shade?: Ink) {
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        if (i * i + j * j > r * r + r * 0.6) continue;
        this.dot(cx + i, cy + j, shade !== undefined && i + j * -1 > r * 0.6 ? shade : c);
      }
  }

  /** A thick tube, e.g. a missile canister seen from the side. */
  tube(x0: number, y0: number, x1: number, y1: number) {
    this.line(x0, y0, x1, y1, Ink.Mid);
    this.line(x0, y0 + 1, x1, y1 + 1, Ink.Light);
    this.line(x0, y0 + 2, x1, y1 + 2, Ink.Highlight);
    this.vline(x1, Math.min(y1, y1), 3, Ink.Dark);
  }
}

interface HullSpec {
  /** First and last x of the hull's deck edge. */
  x0: number;
  x1: number;
  /** Deck height above the waterline, as a function of x (sheer). */
  top: (x: number) => number;
  /** How far the bow rakes back from deck to waterline, and the stern likewise. */
  bowRake: number;
  sternRake: number;
  /** Rows of the coloured band, counted from the waterline (after raising). */
  band: [number, number];
  /** Extra freeboard added to `top`; everything painted afterwards is raised by as much. */
  raise?: number;
}

/** Paints a hull: dark boot-topping at the waterline, the faction band, grey topsides. */
function hull(p: Painter, s: HullSpec) {
  const raise = s.raise ?? 0;
  for (let x = s.x0; x <= s.x1; x++) {
    const top = s.top(x) + raise;
    for (let y = 0; y < top; y++) {
      // the bow and stern overhang: at height y the hull spans a little less at the waterline
      const frac = 1 - y / Math.max(1, top - 1);
      if (x > s.x1 - s.bowRake * frac) continue;
      if (x < s.x0 + s.sternRake * frac) continue;
      let c: Ink = Ink.Mid;
      if (y === 0) c = Ink.Dark;
      else if (y >= s.band[0] && y <= s.band[1]) c = y === s.band[0] ? Ink.BandShade : Ink.Band;
      else if (y === top - 1) c = Ink.Light;
      p.dot(x, y, c);
    }
  }
  p.oy += raise;
}

const flat = (h: number) => () => h;
/** A deck rising towards the bow: `h` aft, `h + rise` at the stem, starting at `from`. */
const sheer = (h: number, rise: number, from: number, to: number) => (x: number) =>
  x <= from ? h : h + Math.round((rise * (x - from)) / (to - from));

/** A red flag with a yellow star in the corner, flying astern from a staff at `x`. */
function redFlag(p: Painter, x: number, y: number, staff = 4) {
  p.vline(x, y, staff + 1, Ink.Dark);
  p.rect(x - 4, y + staff - 2, 4, 3, Ink.FlagA);
  p.dot(x - 4, y + staff, Ink.FlagB);
}

/** The Stars and Stripes, flying astern from a staff at `x`. */
function usFlag(p: Painter, x: number, y: number, staff = 4) {
  p.vline(x, y, staff + 1, Ink.Dark);
  p.rect(x - 4, y + staff - 2, 4, 3, Ink.FlagB);
  p.hline(x - 4, y + staff - 1, 2, Ink.FlagC);
  p.rect(x - 2, y + staff - 1, 2, 2, Ink.FlagA);
}

type Art = (p: Painter) => { hullH: number; hitSpots: [number, number][] };

/** Hit spots spread along the hull, `n` of them, at height `y`. */
function spots(
  n: number,
  x0: number,
  x1: number,
  y: number,
  ys: number[] = [],
): [number, number][] {
  return Array.from({ length: n }, (_, k) => [
    Math.round(x0 + ((x1 - x0) * (k + 0.5)) / n),
    ys[k] ?? y,
  ]);
}

// ---------------------------------------------------------------------------------------------
// USSR: Kiev-class carrier, Slava cruiser, Victor III submarine, Sovremenny destroyer, Osa boat.

const ussr: Record<ShipClass, { w: number; art: Art }> = {
  carrier: {
    w: 106,
    art: (p) => {
      // angled flight deck over the aft two thirds, a forecastle with missiles and guns
      hull(p, {
        x0: 2,
        x1: 104,
        top: sheer(7, 1, 70, 104),
        bowRake: 6,
        sternRake: 1,
        band: [2, 5],
        raise: 2,
      });
      p.rect(0, 7, 72, 2, Ink.Deck);
      p.hline(0, 9, 72, Ink.Mid);
      p.hline(0, 7, 72, Ink.Dark);
      for (let x = 6; x < 60; x += 9) p.hline(x, 8, 4, Ink.White);
      // parked aircraft
      for (const x of [8, 18, 28]) {
        p.hline(x, 10, 5, Ink.Dark);
        p.dot(x + 1, 11, Ink.Dark);
      }
      // the big island with its pyramid mast and radar
      p.block(44, 10, 22, 6, true);
      p.block(47, 16, 15, 4, true);
      p.slopedBlock(62, 10, 7, 5, 3);
      p.lattice(54, 20, 9, 6);
      p.hline(50, 26, 9, Ink.Dark);
      p.rect(52, 27, 5, 2, Ink.Mid);
      p.funnel(47, 20, 5, 4, 1);
      p.mast(58, 20, 12, 4);
      p.disc(58, 32, 1, Ink.Light);
      // forecastle: SS-N-12 tubes, then guns
      p.tube(74, 8, 84, 10);
      p.tube(79, 8, 88, 10);
      p.turret(90, 8, 1, 4, true);
      p.block(72, 8, 3, 3);
      redFlag(p, 58, 22, 6);
      return { hullH: 7, hitSpots: spots(6, 8, 98, 5, [5, 11, 5, 13, 5, 9]) };
    },
  },
  cruiser: {
    w: 98,
    art: (p) => {
      hull(p, {
        x0: 2,
        x1: 96,
        top: sheer(5, 2, 60, 96),
        bowRake: 6,
        sternRake: 1,
        band: [2, 4],
        raise: 2,
      });
      // the long missile tubes along the forward superstructure, angled up to the bow
      p.block(28, 5, 38, 4, true);
      for (let k = 0; k < 2; k++) p.tube(56 + k * 2, 6 + k * 2, 72 + k * 2, 10 + k * 2);
      // bridge and tall pyramid mast
      p.slopedBlock(52, 9, 14, 5, 3, true);
      p.block(54, 14, 8, 3);
      p.lattice(58, 17, 11, 8);
      p.mast(58, 27, 5, 5);
      p.rect(56, 25, 5, 2, Ink.Mid);
      // twin funnels and the aft radar tower ("Top Pair")
      p.funnel(40, 9, 6, 4, 1);
      p.funnel(47, 9, 4, 3, 1);
      p.block(30, 9, 8, 5);
      p.lattice(34, 14, 8, 6);
      p.rect(31, 22, 7, 3, Ink.Light);
      p.hline(31, 24, 7, Ink.Mid);
      p.vline(34, 25, 3, Ink.Dark);
      // guns: twin 130 mm forward, and a stern deckhouse
      p.turret(80, 6, 1, 6, true);
      p.block(10, 5, 14, 3);
      p.dot(14, 8, Ink.Dark);
      p.turret(4, 5, -1, 3);
      redFlag(p, 58, 25, 4);
      return { hullH: 5, hitSpots: spots(5, 10, 88, 3, [3, 10, 7, 3, 4]) };
    },
  },
  submarine: {
    w: 90,
    art: (p) => {
      // Victor III: a teardrop hull with a blunt bow, a long low sail blending in at the back,
      // and the towed-array pod on top of the rudder
      for (let x = 2; x <= 88; x++) {
        const aft = 1 + (x - 2) / 5;
        const fwd = 1 + Math.sqrt(Math.max(0, 88 - x)) * 1.5;
        const h = Math.round(Math.min(5, aft, fwd));
        for (let y = 0; y < h; y++) p.dot(x, y, y === h - 1 ? Ink.Mid : Ink.Hull2);
        p.dot(x, 0, Ink.Black);
      }
      for (let j = 0; j < 10; j++) {
        const cut = Math.round(j * 0.9);
        const w = 17 - cut - (j === 9 ? 1 : 0);
        let c: Ink = j === 9 ? Ink.Mid : Ink.Hull2;
        if (j === 3) c = Ink.BandShade;
        else if (j === 4 || j === 5) c = Ink.Band;
        p.hline(47 + cut, 5 + j, w, c);
      }
      p.vline(61, 15, 2, Ink.Dark);
      // rudder with its pod
      p.rect(4, 1, 3, 7, Ink.Hull2);
      p.rect(0, 7, 12, 2, Ink.Hull2);
      p.hline(1, 9, 10, Ink.Mid);
      p.dot(0, 8, Ink.None);
      redFlag(p, 58, 15, 4);
      return { hullH: 5, hitSpots: spots(4, 12, 80, 3, [3, 3, 11, 3]) };
    },
  },
  destroyer: {
    w: 82,
    art: (p) => {
      hull(p, {
        x0: 2,
        x1: 80,
        top: sheer(5, 2, 48, 80),
        bowRake: 5,
        sternRake: 1,
        band: [2, 4],
        raise: 2,
      });
      // twin 130 mm turrets fore and aft
      p.turret(64, 6, 1, 6, true);
      p.turret(8, 5, -1, 5, true);
      // stepped bridge tower topped by the flat "Top Steer" radar, a small dome ahead of it
      p.slopedBlock(46, 6, 14, 6, 3, true);
      p.block(48, 12, 8, 3, true);
      p.block(50, 15, 5, 2);
      p.vline(52, 17, 2, Ink.Dark);
      p.rect(50, 19, 5, 4, Ink.Light);
      p.vline(54, 19, 4, Ink.Mid);
      p.hline(50, 22, 5, Ink.Highlight);
      p.hline(55, 12, 4, Ink.Light);
      p.dot(58, 12, Ink.Mid);
      p.hline(56, 13, 2, Ink.Highlight);
      // the big boxy funnel, the tall lattice mast behind it, and the hangar
      p.funnel(34, 6, 10, 9, 1);
      p.block(18, 5, 16, 5, true);
      p.lattice(29, 10, 14, 6);
      p.hline(27, 20, 5, Ink.Dark);
      // quad missile launcher beside the bridge
      p.tube(40, 11, 45, 13);
      redFlag(p, 29, 21, 4);
      return { hullH: 5, hitSpots: spots(3, 12, 70, 3, [3, 9, 3]) };
    },
  },
  torpedo: {
    w: 62,
    art: (p) => {
      hull(p, {
        x0: 2,
        x1: 60,
        top: sheer(4, 1, 36, 60),
        bowRake: 4,
        sternRake: 1,
        band: [2, 4],
        raise: 2,
      });
      // four big missile boxes, angled up towards the bow
      for (const [x, y] of [
        [6, 4],
        [30, 4],
      ] as const) {
        p.rect(x, y, 12, 3, Ink.Light);
        p.hline(x, y + 3, 10, Ink.Light);
        p.hline(x + 2, y + 4, 8, Ink.Highlight);
        p.vline(x + 11, y, 4, Ink.Mid);
      }
      p.slopedBlock(18, 4, 12, 5, 2, true);
      p.lattice(23, 9, 7, 4);
      p.disc(23, 17, 2, Ink.Light, Ink.Mid);
      p.turret(46, 5, 1, 3);
      p.turret(0, 4, -1, 2);
      redFlag(p, 23, 12, 4);
      return { hullH: 4, hitSpots: spots(2, 12, 46, 3) };
    },
  },
};

// ---------------------------------------------------------------------------------------------
// USA: Nimitz carrier, Virginia cruiser, Los Angeles submarine, Spruance destroyer,
// Pegasus hydrofoil.

const usa: Record<ShipClass, { w: number; art: Art }> = {
  carrier: {
    w: 106,
    art: (p) => {
      // the flight deck runs the whole length and overhangs the hull
      hull(p, { x0: 4, x1: 100, top: flat(7), bowRake: 8, sternRake: 2, band: [2, 5], raise: 2 });
      p.rect(0, 7, 106, 2, Ink.Deck);
      p.hline(0, 7, 106, Ink.Dark);
      p.hline(0, 9, 106, Ink.Mid);
      for (let x = 4; x < 100; x += 10) p.hline(x, 8, 5, Ink.White);
      // parked aircraft fore and aft of the island
      for (const x of [6, 16, 26, 82, 92]) {
        p.hline(x, 10, 6, Ink.Dark);
        p.dot(x, 11, Ink.Dark);
        p.dot(x + 1, 11, Ink.Dark);
      }
      // compact island aft of midships, with a pole mast and radar
      p.block(58, 10, 12, 6, true);
      p.block(60, 16, 9, 3, true);
      p.rect(63, 19, 3, 1, Ink.Mid);
      p.mast(64, 19, 10, 5);
      p.rect(61, 25, 6, 2, Ink.Mid);
      p.disc(68, 21, 1, Ink.Light);
      usFlag(p, 64, 22, 5);
      return { hullH: 7, hitSpots: spots(6, 8, 98, 5, [5, 11, 5, 13, 5, 5]) };
    },
  },
  cruiser: {
    w: 98,
    art: (p) => {
      hull(p, {
        x0: 2,
        x1: 96,
        top: sheer(5, 2, 64, 96),
        bowRake: 6,
        sternRake: 0,
        band: [2, 4],
        raise: 2,
      });
      // a long, low deckhouse stepping up to the bridge; nuclear, so no funnels
      p.block(28, 5, 38, 4, true);
      p.block(33, 9, 12, 3, true);
      p.slopedBlock(50, 9, 16, 5, 3, true);
      p.block(53, 14, 8, 2);
      // tall fore mast with its planar radar, and the aft mast with a curved antenna
      p.lattice(58, 16, 11, 6);
      p.rect(55, 23, 5, 3, Ink.Mid);
      p.vline(59, 23, 3, Ink.Dark);
      p.mast(58, 27, 5, 5);
      p.lattice(39, 12, 10, 5);
      p.hline(35, 20, 9, Ink.Mid);
      p.hline(36, 21, 7, Ink.Light);
      p.mast(39, 22, 5, 3);
      // 5-inch guns and twin-arm missile launchers at both ends
      p.turret(80, 6, 1, 5);
      p.rect(70, 5, 5, 2, Ink.Mid);
      p.line(70, 7, 75, 9, Ink.Dark);
      p.turret(8, 5, -1, 5);
      p.rect(18, 5, 5, 2, Ink.Mid);
      p.line(22, 7, 17, 9, Ink.Dark);
      usFlag(p, 39, 14, 4);
      return { hullH: 5, hitSpots: spots(5, 10, 88, 3, [3, 9, 6, 11, 3]) };
    },
  },
  submarine: {
    w: 90,
    art: (p) => {
      // a long, slim cigar mostly awash, with a tall narrow sail well forward
      for (let x = 2; x <= 88; x++) {
        const t = (x - 2) / 86;
        const h = Math.min(4, t > 0.85 ? Math.round(1 + (1 - t) * 24) : Math.round(1 + t * 14));
        for (let y = 0; y < h; y++) p.dot(x, y, y === h - 1 ? Ink.Mid : Ink.Hull2);
        p.dot(x, 0, Ink.Black);
      }
      // sail with its fairwater planes, and the band round it
      p.rect(60, 4, 9, 13, Ink.Hull2);
      p.hline(60, 16, 9, Ink.Mid);
      p.vline(60, 4, 12, Ink.Mid);
      p.rect(55, 12, 19, 1, Ink.Hull2);
      p.rect(60, 6, 9, 3, Ink.Band);
      p.hline(60, 6, 9, Ink.BandShade);
      p.vline(66, 17, 2, Ink.Dark);
      // upper rudder
      p.rect(3, 1, 3, 7, Ink.Hull2);
      usFlag(p, 64, 17, 4);
      return { hullH: 4, hitSpots: spots(4, 12, 80, 2, [2, 2, 12, 2]) };
    },
  },
  destroyer: {
    w: 82,
    art: (p) => {
      hull(p, {
        x0: 2,
        x1: 80,
        top: sheer(5, 2, 50, 80),
        bowRake: 5,
        sternRake: 0,
        band: [2, 4],
        raise: 2,
      });
      // one long, boxy deckhouse with two square stacks side by side
      p.block(18, 5, 40, 5, true);
      p.slopedBlock(48, 10, 10, 4, 2, true);
      p.funnel(26, 10, 6, 5);
      p.funnel(38, 10, 6, 6);
      p.lattice(51, 14, 9, 5);
      p.mast(51, 23, 6, 5);
      p.mast(41, 14, 9, 3);
      p.block(20, 10, 5, 3);
      // 5-inch guns fore and aft, box launcher
      p.turret(62, 6, 1, 5);
      p.turret(8, 5, -1, 5);
      p.rect(68, 7, 4, 2, Ink.Mid);
      usFlag(p, 41, 18, 4);
      return { hullH: 5, hitSpots: spots(3, 12, 70, 3, [3, 8, 3]) };
    },
  },
  torpedo: {
    w: 62,
    art: (p) => {
      // hydrofoil: the hull rides clear of the water on struts
      const lift = 4;
      hull(p, {
        x0: 4,
        x1: 58,
        top: (x) => lift + 5 + (x > 44 ? 1 : 0),
        bowRake: 4,
        sternRake: 1,
        band: [lift + 1, lift + 3],
      });
      for (let x = 0; x < 62; x++) for (let y = 0; y < lift; y++) p.dot(x, y, Ink.None);
      p.vline(12, 0, lift + 1, Ink.Dark);
      p.vline(50, 0, lift + 1, Ink.Dark);
      p.oy = 1;
      // deckhouse, mast, gun, missile canisters
      p.slopedBlock(22, lift + 4, 16, 4, 3, true);
      p.lattice(28, lift + 8, 6, 4);
      p.disc(28, lift + 15, 1, Ink.Light);
      p.turret(44, lift + 5, 1, 4);
      p.tube(6, lift + 4, 16, lift + 6);
      usFlag(p, 28, lift + 8, 5);
      return { hullH: 7, hitSpots: spots(2, 14, 46, lift + 1) };
    },
  },
};

export const ART: Record<Faction, Record<ShipClass, { w: number; art: Art }>> = { ussr, usa };

export function buildSprite(faction: Faction, cls: ShipClass): Sprite {
  const def = ART[faction][cls];
  const p = new Painter(def.w);
  const { hullH, hitSpots } = def.art(p);
  return {
    w: p.w,
    h: p.h,
    px: p.px,
    hullH: hullH + p.oy,
    hitSpots: hitSpots.map(([x, y]) => [x, y + p.oy]),
  };
}

export const PALETTES: Record<Faction, string[]> = {
  ussr: [
    '',
    '#1c2126', // outline
    '#4b555e', // dark
    '#76828c', // mid
    '#a3aeb7', // light
    '#c9d2d9', // highlight
    '#e0251b', // band
    '#a3150e', // band shade
    '#000000',
    '#474f57', // sub hull
    '#3c4247', // flight deck
    '#e8e8e8',
    '#1a120c', // scorch
    '#ff7a00', // ember
    '#e0251b', // flag
    '#ffd200',
    '#e0251b',
  ],
  usa: [
    '',
    '#22272b',
    '#565f66',
    '#86919a',
    '#b2bcc4',
    '#d6dde2',
    '#f5c400',
    '#b58f00',
    '#000000',
    '#434a51',
    '#45494d',
    '#e8e8e8',
    '#1a120c',
    '#ff7a00',
    '#2a4bb8',
    '#e0251b',
    '#f0f0f0',
  ],
};
