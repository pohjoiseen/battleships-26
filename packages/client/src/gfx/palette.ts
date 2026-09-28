import type { PlayerIndex } from '@bs/shared';

/** ZX Spectrum-flavoured colours (normal and BRIGHT). Placeholder look until the art milestone. */
export const C = {
  black: '#000000',
  blue: '#0000d7',
  brightBlue: '#0000ff',
  red: '#d70000',
  brightRed: '#ff0000',
  magenta: '#d700d7',
  brightMagenta: '#ff00ff',
  green: '#00d700',
  brightGreen: '#00ff00',
  cyan: '#00d7d7',
  brightCyan: '#00ffff',
  yellow: '#d7d700',
  brightYellow: '#ffff00',
  white: '#d7d7d7',
  brightWhite: '#ffffff',
  grey: '#808080',
} as const;

/** Player 1 is red and player 2 yellow, as in the original. */
export const playerColour = (p: PlayerIndex): string => (p === 0 ? C.brightRed : C.brightYellow);
