import type { Layout, Rng } from '@bs/shared';

/** What an AI may know when choosing shots: exactly what a human sees on the enemy sea. */
export interface ShotRequest {
  /** SEA_* per cell of the enemy sea. */
  sea: number[];
  /** Hits taken per enemy ship id (shown by the ship pictures). */
  damage: number[];
  count: number;
}

export interface AiPlayer {
  placeFleet(rng: Rng): Layout;
  /** Distinct, not-yet-shot cells; exactly `count` of them. */
  chooseShots(request: ShotRequest, rng: Rng): number[];
}
