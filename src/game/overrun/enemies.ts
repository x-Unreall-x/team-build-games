/**
 * Enemy roster + steering. Rushers swarm fast and nibble; tanks lumber in and
 * hit hard. AI is chase-nearest-alive with lowest-id tie-breaks (deterministic).
 */

import {
  ENEMY_SEPARATION_WEIGHT, OVERRUN_FIELD_M, PLAYER_RADIUS_M,
  RUSH_CHARGE_S, RUSH_COOLDOWN_S, RUSH_RECOVER_S, RUSH_RUN_MAX_S, RUSH_SPEED_MS,
} from "./constants";
import type { Enemy, EnemyKind, ShooterPlayer, Vec2 } from "./types";

export interface EnemyDef {
  kind: EnemyKind;
  /** Physical ground radius used for movement, contact damage, and field bounds. */
  radius: number;
  /** Projectile hit radius, matched to the rendered sprite's full visible width. */
  hitRadius: number;
  speed: number;
  health: number;
  /** Contact damage per attack. */
  damage: number;
  /** Seconds between contact attacks. */
  attackInterval: number;
  xp: number;
  /** Wave-budget points this kind costs. */
  cost: number;
  /** Score awarded per kill (× current wave). */
  scoreValue: number;
  /** First wave this kind may appear on. */
  minWave: number;
  /** Bullet hits stun + knock this kind back. Heavy units (tank) shrug it off — no stagger. */
  stagger: boolean;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  rusher: { kind: "rusher", radius: 0.4, hitRadius: 8 / 7, speed: 4.5, health: 20, damage: 5, attackInterval: 0.5, xp: 2, cost: 1, scoreValue: 10, minWave: 1, stagger: true },
  tank: { kind: "tank", radius: 0.7, hitRadius: 9 / 7, speed: 1.8, health: 120, damage: 20, attackInterval: 0.8, xp: 8, cost: 4, scoreValue: 40, minWave: 3, stagger: false },
};

/** Stable order — this index IS the wire encoding of a kind. Append only. */
export const ENEMY_KINDS: EnemyKind[] = ["rusher", "tank"];

/** Closest living player (input must be sorted by id; ties keep the first = lowest id). */
export function nearestAlive(pos: Vec2, players: ShooterPlayer[]): ShooterPlayer | null {
  let best: ShooterPlayer | null = null;
  let bestD = Infinity;
  for (const p of players) {
    const d = Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/**
 * Chase the target, stopping at contact range; always tick the attack cooldown (and the
 * bullet-hit micro-stun). `speedMult` scales the kind's base speed (wave-1 slowdown). While
 * stunned (stunRemaining > 0 at the START of this tick) the enemy does not move at all — but
 * cooldowns still tick, so a stun-locked enemy isn't also attack-locked past its own timer.
 */
export function stepEnemy(
  e: Enemy,
  target: Vec2 | null,
  dt: number,
  speedMult = 1,
  separation: Vec2 = { x: 0, y: 0 },
): Enemy {
  const def = ENEMIES[e.kind];
  const cooled = Math.max(0, e.attackCooldown - dt);
  const stunRemaining = Math.max(0, e.stunRemaining - dt);
  // stunRemaining also carries the post-attack freeze — a frozen enemy holds position.
  if (e.stunRemaining > 0) return { ...e, attackCooldown: cooled, stunRemaining };

  const maxMove = def.speed * speedMult * dt;
  let moveX = 0;
  let moveY = 0;

  // Chase: ease to contact range with the target (positive desiredMove = too close → back off).
  if (target) {
    const dx = target.x - e.pos.x;
    const dy = target.y - e.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= 1e-9) {
      const contact = def.radius + PLAYER_RADIUS_M;
      const desiredMove = contact - dist;
      const clampedMove = Math.max(-maxMove, Math.min(maxMove, desiredMove));
      moveX = -(dx / dist) * clampedMove;
      moveY = -(dy / dist) * clampedMove;
    }
  }

  // Separation: push out of the crowd so the horde spreads around the player instead of stacking.
  moveX += separation.x * maxMove * ENEMY_SEPARATION_WEIGHT;
  moveY += separation.y * maxMove * ENEMY_SEPARATION_WEIGHT;

  const pos = {
    x: clamp(e.pos.x + moveX, def.radius, OVERRUN_FIELD_M - def.radius),
    y: clamp(e.pos.y + moveY, def.radius, OVERRUN_FIELD_M - def.radius),
  };
  return { ...e, pos, attackCooldown: cooled, stunRemaining };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Tank Rush state machine + movement (deterministic; no RNG/clock). A tank chases (`none`) while its
 * Rush cooldown ticks down; when it elapses it TELEGRAPHS (`rushCharge`, 0.5 s frozen) and locks the
 * target's current ground position, then CHARGES straight to that fixed point (`rushRun`) at
 * RUSH_SPEED_MS (2× rusher), and on arrival (or the safety cap) enters `rushRecover` (0.5 s frozen),
 * returning `landed: true` on that tick so the caller applies the 50%-HP area hit. `aimPos` is the
 * lead-intercept point used for the normal chase; `lockPos` is the target's REAL position to lock.
 */
export function stepTank(
  e: Enemy,
  aimPos: Vec2 | null,
  lockPos: Vec2 | null,
  dt: number,
  speedMult: number,
  separation: Vec2,
): { enemy: Enemy; landed: boolean } {
  const def = ENEMIES.tank;
  const cooled = Math.max(0, e.attackCooldown - dt);
  const stun = Math.max(0, e.stunRemaining - dt);
  const special = e.special ?? "none";
  const remaining = (e.specialRemaining ?? RUSH_COOLDOWN_S) - dt;
  const bound = (p: Vec2): Vec2 => ({
    x: clamp(p.x, def.radius, OVERRUN_FIELD_M - def.radius),
    y: clamp(p.y, def.radius, OVERRUN_FIELD_M - def.radius),
  });

  // Telegraph + recovery: frozen in place; cooldowns still tick.
  if (special === "rushCharge") {
    if (remaining > 0) return { enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, specialRemaining: remaining }, landed: false };
    return { enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, special: "rushRun", specialRemaining: RUSH_RUN_MAX_S }, landed: false };
  }
  if (special === "rushRecover") {
    if (remaining > 0) return { enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, specialRemaining: remaining }, landed: false };
    return { enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, special: "none", specialRemaining: RUSH_COOLDOWN_S, rushTo: null }, landed: false };
  }

  // Charge: run straight to the locked point at RUSH_SPEED_MS, ignoring steering/separation.
  if (special === "rushRun") {
    const to = e.rushTo ?? null;
    if (!to) return { enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, special: "rushRecover", specialRemaining: RUSH_RECOVER_S }, landed: true };
    const dx = to.x - e.pos.x;
    const dy = to.y - e.pos.y;
    const dist = Math.hypot(dx, dy);
    const step = RUSH_SPEED_MS * dt;
    const arrived = dist <= step || remaining <= 0;
    const pos = arrived ? bound(to) : bound({ x: e.pos.x + (dx / dist) * step, y: e.pos.y + (dy / dist) * step });
    if (arrived) return { enemy: { ...e, pos, attackCooldown: cooled, stunRemaining: stun, special: "rushRecover", specialRemaining: RUSH_RECOVER_S }, landed: true };
    return { enemy: { ...e, pos, attackCooldown: cooled, stunRemaining: stun, specialRemaining: remaining }, landed: false };
  }

  // "none": trigger a Rush when the cooldown elapses (freeze + lock); otherwise chase normally.
  if (e.stunRemaining <= 0 && remaining <= 0 && lockPos) {
    return {
      enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, special: "rushCharge", specialRemaining: RUSH_CHARGE_S, rushTo: { ...lockPos } },
      landed: false,
    };
  }
  const stepped = stepEnemy(e, aimPos, dt, speedMult, separation);
  return { enemy: { ...stepped, special: "none", specialRemaining: Math.max(0, remaining) }, landed: false };
}
