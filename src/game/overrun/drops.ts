/**
 * Weapon/medkit drop economy: weighted roll per kill, a pity counter that
 * forces a drop after a dry streak, and a hard live-pickup cap (anti-flood +
 * snapshot-size guard). Pity lives IN the world so host migration keeps it.
 */

import { DROP_MEDKIT_P, DROP_WEAPON_P, MAX_PICKUPS, PICKUP_TTL_S, PITY_LIMIT } from "./constants";
import { hash01 } from "./rng";
import type { Enemy, Pickup, PickupKind } from "./types";

export function rollDrop(
  seed: number,
  tick: number,
  enemy: Enemy,
  pickupsLive: number,
  pity: number,
): { pickup: Pickup | null; pity: number } {
  if (pickupsLive >= MAX_PICKUPS) return { pickup: null, pity: pity + 1 };
  const r = hash01(seed, tick, enemy.id, "drop");
  const forced = pity + 1 >= PITY_LIMIT;
  let kind: PickupKind | null = null;
  if (r < DROP_WEAPON_P) {
    kind = hash01(seed, tick, enemy.id, "gun") < 0.5 ? "shotgun" : "rifle";
  } else if (r < DROP_WEAPON_P + DROP_MEDKIT_P) {
    kind = "medkit";
  } else if (forced) {
    kind = hash01(seed, tick, enemy.id, "pity") < 0.5 ? "medkit" : hash01(seed, tick, enemy.id, "gun") < 0.5 ? "shotgun" : "rifle";
  }
  if (!kind) return { pickup: null, pity: pity + 1 };
  return {
    pickup: { id: `pk:${enemy.id}`, kind, pos: { x: enemy.pos.x, y: enemy.pos.y }, ttl: PICKUP_TTL_S },
    pity: 0,
  };
}
