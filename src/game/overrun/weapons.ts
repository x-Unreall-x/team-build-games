/**
 * The slice's 3-gun arsenal — all hitscan (bullets resolve on the fire tick and
 * NEVER serialize). Numbers from the roadmap START table; tune in playtest.
 */

import type { AmmoState, GunId } from "./types";

export interface GunDef {
  id: GunId;
  name: string;
  /** Damage per pellet (pre-perk). */
  damage: number;
  rpm: number;
  magSize: number;
  /** Max reserve rounds; null = infinite (the pistol fallback). */
  reserveMax: number | null;
  reloadS: number;
  /** Max deviation (degrees) either side of the aim. */
  spreadDeg: number;
  pellets: number;
  /** Hitscan range in meters. */
  range: number;
  /** Enemies a single pellet passes through beyond the first. */
  pierce: number;
}

export const GUNS: Record<GunId, GunDef> = {
  pistol: { id: "pistol", name: "Pistol", damage: 12, rpm: 300, magSize: 12, reserveMax: null, reloadS: 1.2, spreadDeg: 2, pellets: 1, range: 20, pierce: 0 },
  shotgun: { id: "shotgun", name: "Shotgun", damage: 8, rpm: 70, magSize: 6, reserveMax: 36, reloadS: 1.0, spreadDeg: 9, pellets: 8, range: 12, pierce: 0 },
  rifle: { id: "rifle", name: "Rifle", damage: 34, rpm: 220, magSize: 10, reserveMax: 60, reloadS: 1.6, spreadDeg: 1, pellets: 1, range: 40, pierce: 1 },
};

export const GUN_IDS: GunId[] = ["pistol", "shotgun", "rifle"];
export const DEFAULT_GUN: GunId = "pistol";

/** Narrow an untrusted value to a known gun id. */
export function coerceGun(raw: unknown): GunId {
  return GUN_IDS.includes(raw as GunId) ? (raw as GunId) : DEFAULT_GUN;
}

/** Full mag + full reserve (0 for the infinite pistol — its reserve is never consumed). */
export function freshAmmo(gun: GunId): AmmoState {
  const def = GUNS[gun];
  return { mag: def.magSize, reserve: def.reserveMax ?? 0, reloadRemaining: 0, fireCooldown: 0 };
}

/** Can this gun still reload? The pistol always can (infinite reserve). */
export function hasReserve(gun: GunId, ammo: AmmoState): boolean {
  return GUNS[gun].reserveMax === null || ammo.reserve > 0;
}
