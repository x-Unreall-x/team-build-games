/**
 * Survival enemy model (P-A2). Host-owned creatures that spawn outside the field and crawl toward the
 * allied party. Pure data + a wire-trust boundary (`coerceEnemy`) so a snapshot from an untrusted host
 * can only ever produce a well-formed enemy. Deterministic ids `e{level}-{seq}` are assigned by the
 * wave/step logic; the model itself holds no counters.
 */

import type { Direction, Vec2 } from "../types";
import type { SurvivalEnemyKind } from "./waves";

export interface EnemyStats {
  maxHealth: number;
  /** Metres per second crawling toward the party. */
  speed: number;
  /** Health removed from a player on contact. */
  contactDamage: number;
  /** Seconds between contact hits from the same enemy. */
  hitCooldown: number;
  /** Body radius (metres) for contact + separation. */
  radius: number;
}

/** Per-kind stat table. One archetype for now (roadmap: prove the pipeline before adding variety). */
export const ENEMY_STATS: Record<SurvivalEnemyKind, EnemyStats> = {
  crawler: { maxHealth: 2, speed: 2.4, contactDamage: 1, hitCooldown: 0.8, radius: 0.4 },
};

export interface EnemyState {
  id: string;
  kind: SurvivalEnemyKind;
  pos: Vec2;
  facing: Direction;
  aim: number;
  health: number;
  maxHealth: number;
  status: "alive" | "dead";
  hitCooldownRemaining: number;
  spawnTick: number;
}

const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];
const KINDS = Object.keys(ENEMY_STATS) as SurvivalEnemyKind[];
const DEFAULT_KIND: SurvivalEnemyKind = "crawler";

export function createEnemy(id: string, kind: SurvivalEnemyKind, pos: Vec2, spawnTick: number): EnemyState {
  const stats = ENEMY_STATS[kind];
  return {
    id,
    kind,
    pos: { x: pos.x, y: pos.y },
    facing: "down",
    aim: Math.PI / 2,
    health: stats.maxHealth,
    maxHealth: stats.maxHealth,
    status: "alive",
    hitCooldownRemaining: 0,
    spawnTick,
  };
}

const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Sanitize an untrusted enemy from the wire into a well-formed one (host snapshot trust boundary). */
export function coerceEnemy(raw: unknown): EnemyState {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kind = KINDS.includes(r.kind as SurvivalEnemyKind) ? (r.kind as SurvivalEnemyKind) : DEFAULT_KIND;
  const maxHealth = ENEMY_STATS[kind].maxHealth;
  const pos = (r.pos ?? {}) as { x?: unknown; y?: unknown };
  const health = Math.max(0, Math.min(maxHealth, num(r.health, 0)));
  return {
    id: typeof r.id === "string" ? r.id : "",
    kind,
    pos: { x: num(pos.x, 0), y: num(pos.y, 0) },
    facing: DIRECTIONS.includes(r.facing as Direction) ? (r.facing as Direction) : "down",
    aim: num(r.aim, 0),
    health,
    maxHealth,
    status: health > 0 && r.status === "alive" ? "alive" : "dead",
    hitCooldownRemaining: Math.max(0, num(r.hitCooldownRemaining, 0)),
    spawnTick: Math.max(0, Math.floor(num(r.spawnTick, 0))),
  };
}
