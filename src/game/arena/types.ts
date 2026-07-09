/**
 * Shared, engine/transport-free domain types for the Arena sim core.
 * Everything here is plain data — no Phaser, no DOM, no network.
 *
 * Coordinate convention: world is in METERS; +x is right, +y is DOWN (so "up" is -y).
 */

import type { Weapon } from "./weapons";

export interface Vec2 {
  x: number;
  y: number;
}

/** Held movement keys for one frame. */
export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** Movement keys plus the action keys (Shift = dash, Space = attack), held state. */
export interface RawInput extends InputState {
  dash: boolean;
  attack: boolean;
  /** Free-aim angle in radians (mouse). Optional: falls back to the facing direction. */
  aim?: number;
}

/** Four-way facing — the side a figure last moved toward. */
export type Direction = "up" | "down" | "left" | "right";

export type PlayerId = string;

/** A player is alive until health hits 0, then dead (spectating in the UI). */
export type PlayerStatus = "alive" | "dead";

/** Cooldown/“in-progress” state for the dash ability. */
export interface DashState {
  /** Seconds left until dash can be used again (0 = ready). */
  cooldownRemaining: number;
  /** True while the dash burst is still moving the player. */
  dashing: boolean;
  /** Meters of dash distance left to travel. */
  distRemaining: number;
}

/** A swing in progress, purely for hit direction + render; damage resolves at initiation. */
export interface AttackState {
  /** Aim angle (radians) locked at swing initiation — the cone + weapon sweep around it. */
  aim: number;
  /** Seconds left to show the swing. */
  ttl: number;
}

export interface PlayerState {
  id: PlayerId;
  pos: Vec2;
  /** Movement facing (4-way) — drives the body sprite. */
  facing: Direction;
  /** Free-aim angle (radians) — drives the weapon + attack cone. */
  aim: number;
  /** Equipped weapon (fixed for the match) — sets reach / arc / cadence / knockback. */
  weapon: Weapon;
  health: number;
  status: PlayerStatus;
  dash: DashState;
  /** Active swing, or null when not attacking. */
  attack: AttackState | null;
  /** Seconds until the next attack is allowed (0 = ready). */
  attackCooldownRemaining: number;
  /** Per-match cumulative stats (render/scoreboard only; never affects the sim). */
  stats: PlayerStats;
}

/** Cosmetic per-player tallies shown on the finished scoreboard (P8). */
export interface PlayerStats {
  /** Attacks that landed on >=1 target (melee swing connected, or arrow hit). */
  hits: number;
  /** Attacks that connected with nobody (melee whiff, or arrow expired). */
  misses: number;
  /** Total metres travelled. */
  distance: number;
}

/** What a client sends per tick — never positions or health. */
export interface Intent {
  move: InputState;
  /** Movement facing (body orientation), derived from the last movement. */
  facing: Direction;
  /** Free-aim angle in radians (mouse). Optional: falls back to the facing direction. */
  aim?: number;
  /** Rising-edge: requested a dash this tick. */
  dash: boolean;
  /** Rising-edge: requested an attack this tick. */
  attack: boolean;
}

/** Per-player memory needed to derive an Intent from raw input (edge detection). */
export interface InputMemory {
  facing: Direction;
  dashHeld: boolean;
  attackHeld: boolean;
}

export type MatchPhase = "lobby" | "countdown" | "playing" | "ended";

/** An in-flight ranged projectile (e.g. a bow arrow). Host-simulated, carried in the World + snapshots. */
export interface Projectile {
  /** Deterministic id `${ownerId}#${tick}` — fire rate is cooldown-gated, so it is unique per shot. */
  id: string;
  ownerId: PlayerId;
  pos: Vec2;
  /** Velocity in meters/second. */
  vel: Vec2;
  /** Meters of travel left before it expires. */
  distRemaining: number;
  /** Hearts removed on hit. */
  damage: number;
  /** Meters the victim is knocked back, along the projectile's heading. */
  knockback: number;
}

export interface World {
  players: Record<PlayerId, PlayerState>;
  /** In-flight ranged projectiles (host-owned). */
  projectiles: Projectile[];
  phase: MatchPhase;
  /** Monotonic tick counter (host-owned). */
  tick: number;
  /** Set when phase === "ended": the survivor, or null if everyone died. */
  winnerId: PlayerId | null;
}
