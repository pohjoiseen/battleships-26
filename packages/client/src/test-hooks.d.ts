import type { PlayerView } from '@bs/shared';

/** Hooks the game page exposes for end-to-end tests, to find things on the canvas. */
declare global {
  interface Window {
    __bs?: {
      view: () => PlayerView | null;
      screen: () => string;
      cellPoint: (index: number) => { x: number; y: number };
      buttonPoint: (id: string) => { x: number; y: number; enabled: boolean } | null;
      draft: () => unknown;
      opponentCursor: () => number | null;
    };
  }
}
