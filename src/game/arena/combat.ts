/**
 * Pure attack resolution. No engine/DOM/clock/RNG.
 *
 * An attack reaches SWORD_REACH_M meters in the attacker's (locked) facing direction,
 * inside a forward cone (ATTACK_CONE_HALF_ANGLE). Each hit is a -1 health event;
 * damage is resolved once, on the tick the swing is initiated.
 */

import type { PlayerId, PlayerState, Vec2 } from "./types";
import { aimVector } from "./logic";
import { WEAPONS } from "./weapons";
import { ATTACK_COOLDOWN_S, FIGURE_RADIUS_M } from "../constants";

export interface DamageEvent {
  fromId: PlayerId;
  targetId: PlayerId;
}

/**
 * Anything an attack can land on — a player OR a survival enemy. Only id/pos/status are needed to
 * resolve a hit, so the same cone/line geometry serves both modes (players-vs-players in versus,
 * players-vs-enemies in survival). `PlayerState` and `EnemyState` are both structurally `Hittable`.
 */
export interface Hittable {
  id: PlayerId;
  pos: Vec2;
  status: "alive" | "dead";
}

/** Attack recharge progress in [0,1]: 0 just after a swing → 1 when ready (UI sweep). */
export function attackCooldownFraction(remainingS: number, total = ATTACK_COOLDOWN_S): number {
  return Math.max(0, Math.min(1, 1 - remainingS / total));
}

/**
 * True when `target` is within `reach` of `origin` and inside the forward cone of
 * half-angle `halfAngle` around the aim angle `aim` (radians). A point-blank target
 * (same position) always hits.
 */
export function inAttackCone(
  origin: Vec2,
  aim: number,
  target: Vec2,
  reach: number,
  halfAngle: number,
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return true; // point-blank
  if (dist > reach) return false;
  const f = aimVector(aim);
  const cos = (dx * f.x + dy * f.y) / dist;
  // Inclusive cone edge: tolerate floating-point error at exactly the half-angle.
  return cos >= Math.cos(halfAngle) - 1e-9;
}

/**
 * True when `target` lies in a straight forward BAND along `aim` (a thrust, e.g. the spear):
 * within `reach` ahead of `origin` and no more than `halfWidth` to either side of the aim ray.
 * Unlike a cone, the band does not widen with distance.
 */
export function inAttackLine(
  origin: Vec2,
  aim: number,
  target: Vec2,
  reach: number,
  halfWidth: number,
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const f = aimVector(aim);
  const along = dx * f.x + dy * f.y; // forward projection onto the aim ray
  if (along < 0 || along > reach) return false;
  const perp = Math.abs(dx * -f.y + dy * f.x); // distance to the aim ray
  return perp <= halfWidth + 1e-9;
}

/**
 * Resolve one attacker's melee swing against candidate players, emitting a damage event per
 * alive, non-self target hit. The hit shape comes from the attacker's weapon: a widening cone
 * (sword/knife) or a straight forward band (thrust weapons, e.g. spear). Self is skipped.
 */
export function resolveAttack(attacker: PlayerState, candidates: readonly Hittable[]): DamageEvent[] {
  const stats = WEAPONS[attacker.weapon];
  // The whole body is hittable: a target is hit once its body (radius FIGURE_RADIUS_M) overlaps
  // the weapon's reach — not only when its center is in range.
  const bodyReach = stats.reach + FIGURE_RADIUS_M;
  const events: DamageEvent[] = [];
  for (const t of candidates) {
    if (t.id === attacker.id) continue;
    if (t.status !== "alive") continue;
    const hit = stats.thrust
      ? inAttackLine(attacker.pos, attacker.aim, t.pos, bodyReach, stats.thrust.halfWidth + FIGURE_RADIUS_M)
      : inAttackCone(attacker.pos, attacker.aim, t.pos, bodyReach, stats.coneHalfAngle);
    if (hit) events.push({ fromId: attacker.id, targetId: t.id });
  }
  return events;
}
