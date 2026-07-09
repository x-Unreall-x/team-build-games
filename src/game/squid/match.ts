// src/game/squid/match.ts
/** Round lifecycle helpers: world creation + finish-time computation. */

import { TICK_HZ } from "../constants";
import { emptyControl } from "./control";
import { buildLegs, buildPoints } from "./octopus";
import type { PlayerId, SquidWorld, StageId } from "./types";

export function createSquidWorld(stage: StageId, playerIds: PlayerId[]): SquidWorld {
  return {
    phase: "playing",
    tick: 0,
    stage,
    points: buildPoints(),
    legs: buildLegs(),
    control: emptyControl(),
    playerIds: [...playerIds].sort(),
    elapsedTicks: 0,
    result: null,
  };
}

/** The round time in ms (exact — derived from the deterministic tick count). */
export function timeMsOf(world: SquidWorld): number {
  return Math.round((world.elapsedTicks / TICK_HZ) * 1000);
}
