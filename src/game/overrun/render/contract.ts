/** Contract between the Overrun Phaser scene and whatever drives the match. */

import type { GunId, PerkOffer, PlayerId, RawShooterInput, ShooterStatus, ShooterWorld } from "../types";

export interface OverrunMeta {
  name: string;
  colorIndex: number;
}

export interface OverrunDriver {
  readonly localId: PlayerId;
  frame(dt: number, input: RawShooterInput): { world: ShooterWorld; countdown: number };
  getMeta(id: PlayerId): OverrunMeta;
}

export interface TeammateHud {
  id: PlayerId;
  name: string;
  colorIndex: number;
  status: ShooterStatus;
  health: number;
}

export interface OverrunHudState {
  countdown: number;
  health: number;
  maxHealth: number;
  status: ShooterStatus;
  gun: GunId;
  mag: number;
  /** null = infinite (pistol). */
  reserve: number | null;
  /** 0..1 of an active reload (0 = idle). */
  reloadFraction: number;
  wave: number;
  intermission: number;
  score: number;
  xp: number;
  xpNext: number;
  level: number;
  /** Head of the local player's offer queue (null = nothing to pick). */
  offer: PerkOffer | null;
  offersQueued: number;
  kills: number;
  teammates: TeammateHud[];
}

export type OverrunEvent =
  | { type: "tik"; n: number }
  | { type: "go" }
  | { type: "shot" }
  | { type: "kill" }
  | { type: "pickup" }
  | { type: "levelup" }
  | { type: "downed"; local: boolean }
  | { type: "revived" }
  | { type: "gameover" };

export interface OverrunConfig {
  driver: OverrunDriver;
  onHud: (h: OverrunHudState) => void;
  onEvent: (e: OverrunEvent) => void;
  /** Fired once when the run ends, with the final world (scorecard + merch payload source). */
  onEnd: (world: ShooterWorld) => void;
}
