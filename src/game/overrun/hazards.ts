/**
 * Ground-hazard lifecycle (pure; no RNG/clock). A hazard warns for `telegraph` seconds, then deals
 * `dps` to players within `radius` for `duration` seconds, then despawns. Damage application lives in
 * the sim (it needs the player set); this module owns only the per-hazard time evolution.
 */

import type { Hazard } from "./types";

/** A hazard deals damage only after its telegraph has fully elapsed. */
export function hazardActive(h: Hazard): boolean {
  return h.telegraph <= 0;
}

/**
 * Advance one hazard by dt. The telegraph burns down FIRST (and any dt overshoot past 0 is dropped, not
 * charged to the active window — so the full damage duration is always honoured); only once active does
 * `duration` burn. Returns null when the active window is spent (caller drops it).
 */
export function stepHazard(h: Hazard, dt: number): Hazard | null {
  if (h.telegraph > 0) {
    return { ...h, telegraph: Math.max(0, h.telegraph - dt) };
  }
  const duration = h.duration - dt;
  return duration > 0 ? { ...h, duration } : null;
}
