/**
 * Pure, versioned wire protocol. JSON envelope for now (correctness-first); binary packing
 * is a later optimization. `coerceIntent` is the trust boundary — the host runs every remote
 * input through it so a peer can only ever send well-formed *intent bits*, never positions/health.
 */

import type { Direction, Intent, PlayerId, Projectile, World } from "../arena/types";
import type { Shape } from "../arena/cosmetic";
import type { Weapon } from "../arena/weapons";

export const PROTOCOL_VERSION = 1;

export interface RosterEntry {
  id: PlayerId;
  name: string;
  iconColor: number;
  shape: Shape;
  weapon: Weapon;
  alive: boolean;
}

/** A participant in a starting match (humans + host-controlled bots). */
export interface StartPlayer {
  id: PlayerId;
  name: string;
  iconColor: number;
  shape: Shape;
  weapon: Weapon;
  isBot: boolean;
}

export type NetMessage =
  | { t: "hello"; name: string; iconColor: number; shape: Shape; weapon: Weapon }
  | { t: "roster"; hostId: PlayerId; players: RosterEntry[] }
  | { t: "kick"; targetId: PlayerId }
  | { t: "start"; countdownMs: number; players: StartPlayer[] }
  | { t: "input"; tick: number; intent: Intent }
  | {
      t: "snapshot";
      tick: number;
      phase: World["phase"];
      winnerId: PlayerId | null;
      players: World["players"];
      projectiles: Projectile[];
    }
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
