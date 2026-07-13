/**
 * Pure ranged-projectile helpers (bow arrows now; the foundation the shooter's guns build on).
 * No engine/DOM/clock/RNG — the host advances projectiles in `stepWorld` and broadcasts them in the
 * snapshot, so every peer sees identical flight. Ids are `${ownerId}#${tick}` (fire rate is
 * cooldown-gated → unique per shot), which keeps spawning deterministic without a mutable counter.
 */

import type { PlayerId, Projectile, Vec2 } from "./types";
import type { Hittable } from "./combat";
import { aimVector } from "./logic";
import { FIGURE_RADIUS_M, PROJECTILE_RADIUS_M } from "../constants";

export interface SpawnArrowSpec {
  ownerId: PlayerId;
  pos: Vec2;
  aim: number;
  tick: number;
  speed: number;
  range: number;
  damage: number;
  knockback: number;
}

/** Launch an arrow from `pos` along `aim` at `speed`; travels `range` meters before expiring. */
export function spawnArrow(s: SpawnArrowSpec): Projectile {
  const v = aimVector(s.aim);
  return {
    id: `${s.ownerId}#${s.tick}`,
    ownerId: s.ownerId,
    pos: { x: s.pos.x, y: s.pos.y },
    vel: { x: v.x * s.speed, y: v.y * s.speed },
    distRemaining: s.range,
    damage: s.damage,
    knockback: s.knockback,
  };
}

/** Advance a projectile one tick, spending range by the distance travelled. */
export function advanceProjectile(p: Projectile, dt: number): Projectile {
  const step = Math.hypot(p.vel.x, p.vel.y) * dt;
  return {
    ...p,
    pos: { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt },
    distRemaining: p.distRemaining - step,
  };
}

/**
 * The nearest alive, non-owner target whose body the projectile overlaps, or null. Resolves against
 * any `Hittable` (id/pos/status) so an arrow lands on other players in versus AND on enemies in
 * survival. (Team-agnostic for now — versus is FFA; a team check slots in here for co-op.)
 */
export function projectileTarget(p: Projectile, targets: readonly Hittable[]): PlayerId | null {
  const reach = FIGURE_RADIUS_M + PROJECTILE_RADIUS_M;
  let best: PlayerId | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    if (t.id === p.ownerId || t.status !== "alive") continue;
    const d = Math.hypot(t.pos.x - p.pos.x, t.pos.y - p.pos.y);
    if (d <= reach && d < bestD) {
      bestD = d;
      best = t.id;
    }
  }
  return best;
}
