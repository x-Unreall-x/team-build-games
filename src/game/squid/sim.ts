// src/game/squid/sim.ts
/**
 * stepSquid — the deterministic heart of the squid game. Pure: no clock, no RNG,
 * no engine imports; dt injected; fixed substeps/iterations. Mirrors the arena's
 * stepWorld contract so the (generic) SyncEngine can drive either game.
 */

import {
  FINISH_X_M,
  HEAD_DROP_FAIL_M,
  LIFT_MAX_Y_M,
  LIFT_MPS,
  PLANT_EPS_M,
  SUBSTEPS,
  SWING_LIFTED_MPS,
  SWING_PLANTED_MPS,
} from "./constants";
import { claimLeg, cycleLeg, legOf } from "./control";
import { HEAD, RIG_CONSTRAINTS } from "./octopus";
import { groundYAt, stageById } from "./stage";
import { integrate, solve } from "./verlet";
import type { PlayerId, RoundResult, SquidIntent, SquidWorld, VPoint } from "./types";

const clonePoints = (points: VPoint[]): VPoint[] =>
  points.map((p) => ({ pos: { ...p.pos }, prev: { ...p.prev } }));

export function stepSquid(
  world: SquidWorld,
  intentsById: Record<PlayerId, SquidIntent>,
  dt: number,
): SquidWorld {
  if (world.phase !== "playing" || world.result !== null) return world;

  const stage = stageById(world.stage);
  const groundAt = (x: number) => groundYAt(x, stage);

  // 1) leg selection — sorted-id iteration for determinism; grabs before cycles
  let control = world.control;
  for (const id of world.playerIds) {
    const g = intentsById[id]?.grabLeg;
    if (g !== undefined) control = claimLeg(control, id, g);
  }
  for (const id of world.playerIds) {
    if (intentsById[id]?.cycle) control = cycleLeg(control, id);
  }

  // 2) leg motors + lift state
  const points = clonePoints(world.points);
  const legs = world.legs.map((leg) => ({ ...leg }));

  // First pass: update lift state from player intents
  for (const id of world.playerIds) {
    const intent = intentsById[id];
    const legIdx = legOf(control, id);
    if (!intent || legIdx === null) continue;
    const leg = legs[legIdx]!;
    leg.lifted = intent.lift;
    if (leg.lifted) leg.planted = false;
  }

  // Second pass: apply motors — lifted legs get tip raised; planted legs get propulsion push
  for (let legIdx = 0; legIdx < legs.length; legIdx++) {
    const leg = legs[legIdx]!;
    const [root, mid, tip] = leg.pts;

    if (leg.lifted) {
      // raise the tip toward the body (position nudge — verlet turns it into velocity)
      const t = points[tip]!;
      t.pos.y = Math.min(LIFT_MAX_Y_M, t.pos.y + LIFT_MPS * dt);
      // swing only applied when a player actively controls the leg with a swing intent
      const controllerId = control[legIdx];
      if (controllerId !== null) {
        const intent = intentsById[controllerId];
        if (intent?.swing) t.pos.x += intent.swing * SWING_LIFTED_MPS * dt;
      }
    } else if (leg.planted) {
      // swing push: only from the controlling player's intent
      const controllerId = control[legIdx];
      if (controllerId !== null) {
        const intent = intentsById[controllerId];
        if (intent?.swing) {
          for (const i of [root, mid]) points[i]!.pos.x += intent.swing * SWING_PLANTED_MPS * dt;
        }
      }
    }
  }

  // 3) physics: substepped integrate + solve, pins = planted tips
  // Lifted legs are disconnected from the rig (they're "floating") — exclude their constraints
  // so they don't transfer ground-reaction forces to the body. The tip is still directly
  // nudged by the motor above; it just won't prop the body if it rests on ground.
  const liftedPts = new Set<number>();
  for (const leg of legs) {
    if (leg.lifted) for (const i of leg.pts) liftedPts.add(i);
  }
  const activeConstraints = RIG_CONSTRAINTS.filter(
    (c) => !liftedPts.has(c.a) && !liftedPts.has(c.b),
  );
  const pinned: boolean[] = Array(points.length).fill(false);
  for (const leg of legs) if (leg.planted) pinned[leg.pts[2]] = true;
  let pts = points;
  for (let s = 0; s < SUBSTEPS; s++) {
    pts = solve(integrate(pts, dt / SUBSTEPS), activeConstraints, pinned, groundAt);
  }
  // pinned tips must not drift (integrate moves everything): restore them
  for (const leg of legs) {
    if (leg.planted) {
      const i = leg.pts[2];
      pts[i] = { pos: { ...world.points[i]!.pos }, prev: { ...world.points[i]!.pos } };
    }
  }

  // 4) plant rule
  for (const leg of legs) {
    const tip = pts[leg.pts[2]]!;
    const g = groundAt(tip.pos.x);
    if (leg.lifted || g === null) leg.planted = false;
    else if (tip.pos.y <= g + PLANT_EPS_M) leg.planted = true;
  }

  // 5) clock + fail/finish
  const elapsedTicks = world.elapsedTicks + 1;
  const head = pts[HEAD]!;
  let result: RoundResult = world.result;
  if (head.pos.y < -HEAD_DROP_FAIL_M) result = "failed";
  else if (head.pos.x >= FINISH_X_M) result = "finished";

  return {
    ...world,
    tick: world.tick + 1,
    points: pts,
    legs,
    control,
    elapsedTicks,
    result,
    phase: result !== null ? "ended" : "playing",
  };
}
