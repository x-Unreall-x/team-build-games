/**
 * Pure, versioned wire protocol. JSON envelope for now (correctness-first); binary packing
 * is a later optimization. `coerceIntent` is the trust boundary — the host runs every remote
 * input through it so a peer can only ever send well-formed *intent bits*, never positions/health.
 */

import type { Direction, Intent, PlayerId, Projectile, World } from "../arena/types";
import type { Shape } from "../arena/cosmetic";
import type { Weapon } from "../arena/weapons";
import type { Placement } from "../arena/rounds";
import type { SquidIntent, SquidWorld, StageId } from "../squid/types";

export const PROTOCOL_VERSION = 1;

export interface RosterEntry {
  id: PlayerId;
  name: string;
  iconColor: number;
  shape: Shape;
  weapon: Weapon;
  avatarUrl?: string | null;
  alive: boolean;
}

/** A participant in a starting match (humans + host-controlled bots). */
export interface StartPlayer {
  id: PlayerId;
  name: string;
  iconColor: number;
  shape: Shape;
  weapon: Weapon;
  avatarUrl?: string | null;
  isBot: boolean;
}

/** A participant in a starting squid round (no weapons/shapes — cosmetics are color+name). */
export interface SquidStartPlayer {
  id: PlayerId;
  name: string;
  iconColor: number;
  avatarUrl?: string | null;
}

export type NetMessage =
  | { t: "hello"; name: string; iconColor: number; shape: Shape; weapon: Weapon; avatarUrl?: string | null; hostId?: PlayerId | null }
  | { t: "roster"; hostId: PlayerId; players: RosterEntry[] }
  | { t: "kick"; targetId: PlayerId }
  // Explicit host assignment/transfer/migration — receivers adopt `hostId` as the authoritative host.
  | { t: "host"; hostId: PlayerId }
  // P8 round fields are optional so a plain single-match `start` (rounds=1, today's behaviour) still validates.
  | { t: "start"; countdownMs: number; players: StartPlayer[]; rounds?: number; roundNumber?: number; tiebreak?: boolean }
  // Host → peers at each round's end: the running tally + phase. `podium` is set on the final board.
  | { t: "standings"; wins: Record<PlayerId, number>; roundNumber: number; rounds: number; phase: "intermission" | "scoreboard"; podium?: Placement[] }
  | { t: "input"; tick: number; intent: Intent }
  | {
      t: "snapshot";
      tick: number;
      phase: World["phase"];
      winnerId: PlayerId | null;
      players: World["players"];
      projectiles: Projectile[];
    }
  | { t: "squidStart"; countdownMs: number; stage: StageId; players: SquidStartPlayer[] }
  | { t: "squidInput"; tick: number; intent: SquidIntent }
  | { t: "squidSnapshot"; world: SquidWorld }
  | { t: "event"; kind: string; targetId?: PlayerId }
  | { t: "ping"; sentAt: number }
  | { t: "pong"; sentAt: number; hostTick: number }
  | { t: "leave" };

export function encode(m: NetMessage): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, m });
}

/** Parse a wire string, returning null on garbage or a version mismatch. */
export function decode(s: string): NetMessage | null {
  try {
    const o = JSON.parse(s) as { v?: number; m?: { t?: unknown } };
    if (o && o.v === PROTOCOL_VERSION && o.m && typeof o.m.t === "string") {
      return o.m as NetMessage;
    }
  } catch {
    /* fall through */
  }
  return null;
}

const MAX_AVATAR_URL_LEN = 512;

/**
 * Sanitize an untrusted avatar URL from a peer (cosmetic trust boundary). Only https URLs of a
 * sane length are accepted — everything else (data:/javascript:/http:/oversized) becomes null so a
 * peer can't make a viewer's browser fetch an arbitrary resource. The image is used only as a texture.
 */
export function coerceAvatarUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (url.length === 0 || url.length > MAX_AVATAR_URL_LEN) return null;
  return url.startsWith("https://") ? url : null;
}

const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

/** Sanitize an untrusted intent into a well-formed one (the host's anti-cheat boundary). */
export function coerceIntent(raw: unknown): Intent {
  const i = (raw ?? {}) as Partial<Intent> & { move?: Partial<Intent["move"]> };
  const m: Partial<Intent["move"]> = i.move ?? {};
  const facing = DIRECTIONS.includes(i.facing as Direction) ? (i.facing as Direction) : "down";
  const aim = Number.isFinite(i.aim) ? (i.aim as number) : undefined;
  return {
    move: { up: !!m.up, down: !!m.down, left: !!m.left, right: !!m.right },
    facing,
    aim,
    dash: !!i.dash,
    attack: !!i.attack,
  };
}

/** Build a World from a snapshot message. */
export function worldFromSnapshot(m: Extract<NetMessage, { t: "snapshot" }>): World {
  return { players: m.players, projectiles: m.projectiles, phase: m.phase, tick: m.tick, winnerId: m.winnerId };
}
