/**
 * Pure attack resolution. No engine/DOM/clock/RNG.
 *
 * An attack reaches SWORD_REACH_M meters in the attacker's (locked) facing direction,
 * inside a forward cone (ATTACK_CONE_HALF_ANGLE). Each hit is a -1 health event;
 * damage is resolved once, on the tick the swing is initiated.
 */

import type { PlayerId, PlayerState, Vec2 } from "./types";
import { aimVector } from "./logic";
import {
  ATTACK_CONE_HALF_ANGLE,
  ATTACK_COOLDOWN_S,
  FIGURE_RADIUS_M,
  SWORD_REACH_M,
} from "../constants";

export interface DamageEvent {
  fromId: PlayerId;
  targetId: PlayerId;
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
 * Resolve one attacker's swing against candidate players, emitting a damage event per
 * alive, non-self target inside the cone. Pass the full player list; self is skipped.
 */
export function resolveAttack(
  attacker: PlayerState,
  candidates: PlayerState[],
  reach = SWORD_REACH_M,
  halfAngle = ATTACK_CONE_HALF_ANGLE,
): DamageEvent[] {
  // The whole body is hittable: the sword reaches `reach`, and a target is hit once its
  // body (radius FIGURE_RADIUS_M) overlaps that reach — not only when its center is in range.
  const bodyReach = reach + FIGURE_RADIUS_M;
  const events: DamageEvent[] = [];
  for (const t of candidates) {
    if (t.id === attacker.id) continue;
    if (t.status !== "alive") continue;
    if (inAttackCone(attacker.pos, attacker.aim, t.pos, bodyReach, halfAngle)) {
      events.push({ fromId: attacker.id, targetId: t.id });
    }
  }
  return events;
}
