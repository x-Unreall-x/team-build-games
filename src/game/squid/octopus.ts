/**
 * Octopus rig: one head hub point + LEG_COUNT legs of 3 chained points each.
 * Constraint topology is static and deterministic, so it is a module const and
 * never rides the wire — snapshots only carry point positions + leg state.
 */

import { BODY_HEIGHT_M, HEAD_START_X_M, LEG_COUNT, LEG_SEGMENT_M } from "./constants";
import type { DistCon, Leg, VPoint } from "./types";

export const HEAD = 0;
export const POINT_COUNT = 1 + LEG_COUNT * 3;

const at = (x: number, y: number): VPoint => ({ pos: { x, y }, prev: { x, y } });

/** Leg k's point indices: root/mid/tip. */
const legPts = (k: number): [number, number, number] => [1 + k * 3, 2 + k * 3, 3 + k * 3];

/** Tip x-offset from the head for leg k: fanned from -0.9 m (behind) to +0.9 m (ahead). */
const tipOffset = (k: number): number => ((k - (LEG_COUNT - 1) / 2) / ((LEG_COUNT - 1) / 2)) * 0.9;

export function buildPoints(): VPoint[] {
  const pts: VPoint[] = [at(HEAD_START_X_M, BODY_HEIGHT_M)];
  for (let k = 0; k < LEG_COUNT; k++) {
    const tipX = HEAD_START_X_M + tipOffset(k);
    // root/mid/tip interpolated from head to tip; the solver settles exact lengths in a few ticks
    for (const f of [1 / 3, 2 / 3, 1]) {
      pts.push(at(HEAD_START_X_M + (tipX - HEAD_START_X_M) * f, BODY_HEIGHT_M * (1 - f)));
    }
  }
  return pts;
}

export function buildLegs(): Leg[] {
  return Array.from({ length: LEG_COUNT }, (_, k) => ({
    pts: legPts(k),
    planted: true,
    lifted: false,
  }));
}

export const RIG_CONSTRAINTS: DistCon[] = Array.from({ length: LEG_COUNT }, (_, k) => {
  const [root, mid, tip] = legPts(k);
  return [
    { a: HEAD, b: root, len: LEG_SEGMENT_M },
    { a: root, b: mid, len: LEG_SEGMENT_M },
    { a: mid, b: tip, len: LEG_SEGMENT_M },
  ];
}).flat();
