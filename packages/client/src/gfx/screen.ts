/** Logical resolution of the landscape screen; the result is scaled up to fit the window. */
export const LW = 400;
export const LH = 300;

/** Whether the window is taller than wide, so the game should lay itself out for portrait. */
export const isPortrait = () => window.innerHeight > window.innerWidth;

/**
 * Draws into a small offscreen buffer and blits it to the visible canvas with nearest-neighbour
 * scaling, so every logical pixel stays a crisp square. The logical size can change from frame to
 * frame (portrait layouts are taller than wide).
 */
export class Screen {
  readonly buffer: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private readonly out: CanvasRenderingContext2D;
  /** CSS pixels of the window's height to leave free for other things on the page. */
  reserve = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.buffer = document.createElement('canvas');
    this.buffer.width = LW;
    this.buffer.height = LH;
    this.ctx = this.buffer.getContext('2d')!;
    this.out = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get w(): number {
    return this.buffer.width;
  }

  get h(): number {
    return this.buffer.height;
  }

  /** Sets the logical size for the frame about to be drawn. */
  setSize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.buffer.width = w;
    this.buffer.height = h;
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const height = Math.max(100, window.innerHeight - this.reserve);
    const fit = Math.min((window.innerWidth * dpr) / this.w, (height * dpr) / this.h);
    // Whole-number scales keep pixels even; on dense screens unevenness is invisible, so use it all.
    const scale = dpr >= 2 ? fit : Math.max(1, Math.floor(fit));
    this.canvas.width = Math.round(this.w * scale);
    this.canvas.height = Math.round(this.h * scale);
    this.canvas.style.width = `${this.canvas.width / dpr}px`;
    this.canvas.style.height = `${this.canvas.height / dpr}px`;
  }

  present(): void {
    this.out.imageSmoothingEnabled = false;
    this.out.drawImage(this.buffer, 0, 0, this.canvas.width, this.canvas.height);
  }

  /** CSS pixels per logical pixel. */
  get scale(): number {
    return this.canvas.getBoundingClientRect().width / this.w;
  }

  toLogical(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * this.w,
      y: ((clientY - r.top) / r.height) * this.h,
    };
  }

  toClient(x: number, y: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (x / this.w) * r.width, y: r.top + (y / this.h) * r.height };
  }
}
