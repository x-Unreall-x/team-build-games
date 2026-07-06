/**
 * Weapon loadout + per-weapon combat stats. Unlike cosmetic shape, weapon IS sim-relevant
 * (it changes reach / arc / cadence / knockback), so it lives on `PlayerState` and is read by
 * the sim. Pure, engine-free. `coerceWeapon` is the wire trust boundary.
 *
 * Melee weapons resolve an instant cone (see `combat.ts`); the bow is ranged and fires an
 * arrow `Projectile` instead (see `sim.ts`).
 */

import { ATTACK_CONE_HALF_ANGLE, ATTACK_COOLDOWN_S, KNOCKBACK_M, SWORD_REACH_M } from "../constants";

export type Weapon = "sword" | "spear" | "knife" | "bow";

export const WEAPON_LIST: Weapon[] = ["sword", "spear", "knife", "bow"];

export const DEFAULT_WEAPON: Weapon = "sword";

export interface WeaponStats {
  /** Melee cone reach in meters (unused for ranged weapons). */
  reach: number;
  /** Half-angle (radians) of the melee cone. */
  coneHalfAngle: number;
  /** Seconds between attacks. */
  cooldown: number;
  /** Meters a hit knocks the victim back. */
  knockback: number;
  /** Present only for ranged weapons: fires a projectile instead of a melee cone. */
  ranged?: { speed: number; range: number };
}

export const WEAPONS: Record<Weapon, WeaponStats> = {
  // Sword == the legacy tuning, so existing players/tests are unchanged.
  sword: { reach: SWORD_REACH_M, coneHalfAngle: ATTACK_CONE_HALF_ANGLE, cooldown: ATTACK_COOLDOWN_S, knockback: KNOCKBACK_M },
  // Spear: long, narrow, slow, heavy knockback.
  spear: { reach: 3.5, coneHalfAngle: Math.PI / 8, cooldown: 1.4, knockback: 4 },
  // Knife: short, wide, fast, light knockback.
  knife: { reach: 1, coneHalfAngle: Math.PI / 3, cooldown: 0.45, knockback: 1 },
  // Bow: ranged — fires an arrow along the aim; no melee cone.
  bow: { reach: 0, coneHalfAngle: 0, cooldown: 1.2, knockback: 0.5, ranged: { speed: 14, range: 16 } },
};

export function coerceWeapon(raw: unknown): Weapon {
  return WEAPON_LIST.includes(raw as Weapon) ? (raw as Weapon) : DEFAULT_WEAPON;
}
