/**
 * Overrun tuning constants. The sim is fixed-step (SHOOTER_TICK_HZ) so cadence,
 * cooldowns, and snapshots are exactly reproducible across host migrations.
 */

/** Fixed simulation rate (Hz) — the session accumulates render dt into whole ticks. */
export const SHOOTER_TICK_HZ = 30;
export const SHOOTER_DT = 1 / SHOOTER_TICK_HZ;
/** Broadcast a snapshot every N ticks (30/3 = 10 Hz). */
export const SNAPSHOT_EVERY_TICKS = 3;
/** Every Nth broadcast is a full keyframe (10 × 0.1 s ≈ 1 s). */
export const KEYFRAME_EVERY = 10;
export const SNAPSHOT_INTERVAL_S = SNAPSHOT_EVERY_TICKS / SHOOTER_TICK_HZ;
/** Cap on catch-up sim ticks per render frame (tab-refocus etc.). */
export const MAX_CATCHUP_TICKS = 4;
/** Overrun's own pre-match countdown (game-neutral COUNTDOWN_S is arena's — kept separate). */
export const OVERRUN_COUNTDOWN_S = 3;

// --- field / players ---
export const OVERRUN_FIELD_M = 30;
export const PLAYER_RADIUS_M = 0.75;
export const PLAYER_HEALTH = 100;
export const PLAYER_SPEED_MS = 4;

// --- caps (snapshot-size + host-CPU guards) ---
export const MAX_ENEMIES = 60;
export const MAX_PICKUPS = 24;
export const MAX_EVENTS = 32;
/** Events older than this many ticks are pruned (renderer consumes them fast). */
export const EVENT_TTL_TICKS = 6;

// --- waves ---
export const SPAWNS_PER_TICK = 2;
export const INTERMISSION_S = 3;

// --- downed / revive ---
export const REVIVE_RANGE_M = 2;
export const REVIVE_S = 3;
export const REVIVE_HEALTH = 50;

// --- pickups / drops ---
export const PICKUP_RADIUS_M = 1;
export const PICKUP_TTL_S = 12;
export const MEDKIT_HEAL = 40;
/** After swapping guns, ignore weapon pickups briefly so you don't instantly re-swap. */
export const SWAP_GUARD_S = 0.5;
export const DROP_WEAPON_P = 0.1;
export const DROP_MEDKIT_P = 0.06;
/** Kills without a drop before one is forced (anti-dry-streak). */
export const PITY_LIMIT = 25;

// --- XP / perks ---
export const XP_BASE = 20;
export const XP_PER_LEVEL = 15;
