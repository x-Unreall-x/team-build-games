/**
 * Power-tiered weapon unlocks (pure). Weapons open up as the party progresses, so the drop
 * pool grows with the challenge:
 *   - Campaign: reaching stage N unlocks tiers 1..N.
 *   - Survival: tier 1 from the start, then one more tier every 2 waves.
 *
 * Tier 5 (rocket launcher) lands with its own increment — the table grows append-only, so the
 * gating rules here don't change when it arrives.
 */

import { stageForWave } from "./stages";
import type { DroppableGun, OverrunMode } from "./types";

/** Cumulative power tiers. `WEAPON_TIERS[t-1]` is the set newly unlocked at tier `t`. */
export const WEAPON_TIERS: DroppableGun[][] = [
  ["shotgun"], // tier 1
  ["autorifle", "rifle"], // tier 2
  ["smg", "dmr"], // tier 3
  ["flamethrower"], // tier 4
];

export const MAX_WEAPON_TIER = WEAPON_TIERS.length;

const clampTier = (t: number): number => Math.max(1, Math.min(MAX_WEAPON_TIER, Math.floor(t)));

/** Highest unlocked tier for the current context (campaign stage, or survival wave pacing). */
export function unlockedTier(mode: OverrunMode, wave: number): number {
  const raw = mode === "campaign" ? stageForWave(wave).stage : Math.floor((Math.max(1, wave) - 1) / 2) + 1;
  return clampTier(raw);
}

/** Every gun that can currently drop — all tiers up to and including the unlocked one. */
export function droppableGuns(mode: OverrunMode, wave: number): DroppableGun[] {
  return WEAPON_TIERS.slice(0, unlockedTier(mode, wave)).flat();
}
