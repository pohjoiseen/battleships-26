/** Logical resolution everything is drawn at; the result is scaled up to fit the window. */
export const LW = 400;
export const LH = 300;

/**
 * Draws into a small offscreen buffer and blits it to the visible canvas with nearest-neighbour
 * scaling, so every logical pixel stays a crisp square.
 */
export class Screen {
  readonly buffer: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private readonly out: CanvasRenderingContext2D;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.buffer = document.createElement('canvas');
    this.buffer.width = LW;
    this.buffer.height = LH;
    this.ctx = this.buffer.getContext('2d')!;
    this.out = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const fit = Math.min((window.innerWidth * dpr) / LW, (window.innerHeight * dpr) / LH);
    // Whole-number scales keep pixels even; on dense screens unevenness is invisible, so use it all.
    const scale = dpr >= 2 ? fit : Math.max(1, Math.floor(fit));
    this.canvas.width = Math.round(LW * scale);
    this.canvas.height = Math.round(LH * scale);
    this.canvas.style.width = `${this.canvas.width / dpr}px`;
    this.canvas.style.height = `${this.canvas.height / dpr}px`;
  }

  present(): void {
    this.out.imageSmoothingEnabled = false;
    this.out.drawImage(this.buffer, 0, 0, this.canvas.width, this.canvas.height);
  }

  toLogical(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * LW, y: ((clientY - r.top) / r.height) * LH };
  }

  toClient(x: number, y: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (x / LW) * r.width, y: r.top + (y / LH) * r.height };
  }
}
