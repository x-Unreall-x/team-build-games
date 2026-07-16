/**
 * Enemy roster + steering. Rushers swarm fast and nibble; tanks lumber in and
 * hit hard. AI is chase-nearest-alive with lowest-id tie-breaks (deterministic).
 */

import { ENEMY_SEPARATION_WEIGHT, OVERRUN_FIELD_M, PLAYER_RADIUS_M } from "./constants";
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
