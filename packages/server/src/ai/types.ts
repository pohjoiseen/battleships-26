import type { Layout, Rng } from '@bs/shared';

/** What a human sees on the enemy sea, and the enemy's fleet, which only a cheat looks at. */
export interface ShotRequest {
  /** SEA_* per cell of the enemy sea. */
  sea: number[];
  /** Hits taken per enemy ship id (shown by the ship pictures). */
  damage: number[];
  count: number;
  /** Where the enemy ships really are. Only the original's AI looks: it cheated. */
  fleet: Layout;
}

export interface AiPlayer {
  placeFleet(rng: Rng): Layout;
  /** Distinct, not-yet-shot cells; exactly `count` of them. */
  chooseShots(request: ShotRequest, rng: Rng): number[];
  /** What it remembers between turns, as JSON, for AIs that remember anything. */
  save?(): unknown;
}
