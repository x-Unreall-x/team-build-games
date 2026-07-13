/**
 * Pure attack resolution. No engine/DOM/clock/RNG.
 *
 * An attack reaches SWORD_REACH_M meters in the attacker's (locked) facing direction,
 * inside a forward cone (ATTACK_CONE_HALF_ANGLE). Each hit is a -1 health event;
 * damage is resolved once, on the tick the swing is initiated.
 */

import type { PlayerId, PlayerState, Projectile, Vec2 } from "./types";
import { aimVector } from "./logic";
import { WEAPONS } from "./weapons";
import {
  ATTACK_COOLDOWN_S,
  BLOCK_COOLDOWN_S,
  BLOCK_WIDTH_MULT,
  FIGURE_RADIUS_M,
  MAX_MELEE_HALF_ANGLE,
  VERTICAL_ARC_BONUS,
  VERTICAL_REACH_BONUS_M,
} from "../constants";

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
  /**
   * Body radius (metres) for the hit test — so each target's zone matches its own sprite. Defaults
   * to the player figure radius; survival enemies pass their per-kind radius (a bat is small, the
   * dino large), which is what makes the hit-zone line up with what's drawn.
   */
  hitRadius?: number;
}

/** Attack recharge progress in [0,1]: 0 just after a swing → 1 when ready (UI sweep). */
export function attackCooldownFraction(
  remainingS: number,
  total = ATTACK_COOLDOWN_S,
): number {
  return Math.max(0, Math.min(1, 1 - remainingS / total));
}

/** Block recharge progress in [0,1]: 0 on use → 1 after one second. */
export function blockCooldownFraction(remainingS: number): number {
  return Math.max(0, Math.min(1, 1 - remainingS / BLOCK_COOLDOWN_S));
}

/**
 * Whether a blocking defender is covering the direction of `source`. The guard uses the
 * defender's weapon arc, widened by 20%; thrust and ranged weapons receive the sword-sized
 * baseline so every loadout has a usable defensive stance.
 */
export function blockCoversSource(
  defender: PlayerState,
  source: Vec2,
): boolean {
  if (defender.status !== "alive" || !defender.block) return false;
  const weapon = WEAPONS[defender.weapon];
  const baseHalfAngle = Math.max(Math.PI / 4, weapon.coneHalfAngle);
  return inAttackCone(
    defender.pos,
    defender.block.aim,
    source,
    Number.POSITIVE_INFINITY,
    baseHalfAngle * BLOCK_WIDTH_MULT,
  );
}

/** A melee strike is intercepted when its attacker is inside the active front guard. */
export function blocksMeleeAttack(
  defender: PlayerState,
  attacker: PlayerState,
): boolean {
  return blockCoversSource(defender, attacker.pos);
}

/** An arrow is intercepted when it is travelling into the active front guard. */
export function blocksProjectile(
  defender: PlayerState,
  projectile: Projectile,
): boolean {
  const speed = Math.hypot(projectile.vel.x, projectile.vel.y);
  if (speed === 0) return false;
  return blockCoversSource(defender, {
    x: defender.pos.x - projectile.vel.x / speed,
    y: defender.pos.y - projectile.vel.y / speed,
  });
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
export function resolveAttack(
  attacker: PlayerState,
  candidates: readonly Hittable[],
): DamageEvent[] {
  const stats = WEAPONS[attacker.weapon];
  // The whole body is hittable: a target is hit once its body (its own `hitRadius`) overlaps the
  // weapon's reach — not only when its center is in range.
  //
  // 2.5D compensation: figures/creatures are drawn tall and the depth axis is foreshortened, so an
  // up/down swing visually strikes parts that sit off the flat footprint. Scale the reach + arc by
  // how vertical the aim is (|sin| → 0 horizontal, 1 straight up/down) so vertical hits register.
  const verticality = Math.abs(Math.sin(attacker.aim));
  const vReach = VERTICAL_REACH_BONUS_M * verticality;
  const arcMult = 1 + VERTICAL_ARC_BONUS * verticality;
  const events: DamageEvent[] = [];
  for (const t of candidates) {
    if (t.id === attacker.id) continue;
    if (t.status !== "alive") continue;
    const bodyRadius = t.hitRadius ?? FIGURE_RADIUS_M;
    const reach = stats.reach + bodyRadius + vReach;
    const hit = stats.thrust
      ? inAttackLine(
          attacker.pos,
          attacker.aim,
          t.pos,
          reach,
          (stats.thrust.halfWidth + bodyRadius) * arcMult,
        )
      : inAttackCone(
          attacker.pos,
          attacker.aim,
          t.pos,
          reach,
          Math.min(stats.coneHalfAngle * arcMult, MAX_MELEE_HALF_ANGLE),
        );
    if (hit) events.push({ fromId: attacker.id, targetId: t.id });
  }
  return events;
}
