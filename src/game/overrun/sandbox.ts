/**
 * Dev sandbox for Overrun: parse the URL query into a config, then build a ready-to-step ShooterWorld
 * with a single local player and a hand-picked set of enemies dropped straight in — no lobby, no P2P, no
 * waves. Pure (no DOM/engine); it drives the REAL stepShooter + renderer, so what you inspect is what
 * ships. The wave machinery is kept inert by the world's shape here + the driver (see sandboxDriver.ts);
 * nothing in the sim needed a sandbox flag. Gated to dev builds by the page that mounts it.
 */

import {
  RUSH_COOLDOWN_S, SPIT_COOLDOWN_S, HIVE_SPAWN_INTERVAL_S, KRAKEN_ATTACK_INTERVAL_S, OVERRUN_FIELD_M,
} from "./constants";
import { ENEMIES, ENEMY_KINDS, krakenHp } from "./enemies";
import { createShooterWorld } from "./match";
import { freshAmmo, GUN_IDS, DEFAULT_GUN } from "./weapons";
import type { Enemy, EnemyKind, GunId, ShooterWorld, Vec2 } from "./types";

export interface OverrunSandboxConfig {
  /** Enemy kinds to spawn, cycled round-robin over `count`. */
  kinds: EnemyKind[];
  count: number;
  /** Enemies act (chase / attack) when true; frozen in place (still killable) when false. */
  ai: boolean;
  /** The gun the local player drops in holding. */
  gun: GunId;
  /** Per-enemy health override, or null for each kind's default (Kraken → party-scaled). */
  hp: number | null;
}

const LOCAL = "you";
const MAX_COUNT = 24;
/** A capable default weapon — the pistol is too weak to probe a boss with. */
const SANDBOX_DEFAULT_GUN: GunId = "rifle";

const isKind = (s: string): s is EnemyKind => (ENEMY_KINDS as string[]).includes(s);

function clampInt(raw: string | null, min: number, max: number, dflt: number): number {
  const n = raw == null ? NaN : Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
}

/** Parse the sandbox query params into a fully-defaulted, clamped config. Unknown values fall back. */
export function parseOverrunSandboxConfig(params: URLSearchParams): OverrunSandboxConfig {
  const parsed = (params.get("enemy") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isKind);
  const kinds: EnemyKind[] = parsed.length ? parsed : ["rusher"];

  const gunRaw = params.get("gun") ?? "";
  const gun: GunId = (GUN_IDS as string[]).includes(gunRaw) ? (gunRaw as GunId) : SANDBOX_DEFAULT_GUN;

  const hpN = Math.floor(Number(params.get("hp")));
  const hp = Number.isFinite(hpN) && hpN > 0 ? hpN : null;

  return {
    kinds,
    count: clampInt(params.get("count"), 1, MAX_COUNT, 3),
    ai: params.get("ai") !== "off",
    gun,
    hp,
  };
}

/** Build one sandbox enemy with the same special-state init the sim uses at spawn. */
export function makeSandboxEnemy(kind: EnemyKind, id: string, pos: Vec2, health: number): Enemy {
  const base: Enemy = { id, kind, pos: { ...pos }, health, attackCooldown: 0, stunRemaining: 0 };
  if (kind === "tank") return { ...base, special: "none", specialRemaining: RUSH_COOLDOWN_S, rushTo: null };
  if (kind === "spitter") return { ...base, special: "none", specialRemaining: SPIT_COOLDOWN_S, rushTo: null };
  if (kind === "hive") return { ...base, special: "none", specialRemaining: HIVE_SPAWN_INTERVAL_S, rushTo: null };
  if (kind === "kraken") return { ...base, special: "none", specialRemaining: KRAKEN_ATTACK_INTERVAL_S, rushTo: null };
  return base;
}

/** Build the ready-to-step sandbox world: one player at centre, `count` enemies ringed around it. */
export function createOverrunSandboxWorld(config: OverrunSandboxConfig): ShooterWorld {
  const c = OVERRUN_FIELD_M / 2;
  const base = createShooterWorld([LOCAL], 1, "survival");
  const you = base.players[LOCAL]!;
  base.players[LOCAL] = { ...you, pos: { x: c, y: c }, aim: 0, gun: config.gun, ammo: freshAmmo(config.gun) };

  const ring = Math.min(c - 3, 8); // just inside the field edge
  const enemies: Enemy[] = [];
  for (let i = 0; i < config.count; i++) {
    const kind = config.kinds[i % config.kinds.length]!;
    const a = (i / config.count) * Math.PI * 2 - Math.PI / 2;
    const pos = { x: c + Math.cos(a) * ring, y: c + Math.sin(a) * ring };
    const health = config.hp ?? (kind === "kraken" ? krakenHp(1) : ENEMIES[kind].health);
    enemies.push(makeSandboxEnemy(kind, `sbx:${i}`, pos, health));
  }

  // wave 1 (not 0) + empty pending + no intermission → the sim's wave machinery never composes a wave.
  return { ...base, wave: 1, partySize: 1, pending: [], intermission: 0, stageIntroRemaining: 0, enemies };
}
