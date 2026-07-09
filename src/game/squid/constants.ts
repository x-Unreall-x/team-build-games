/**
 * Squid tuning constants. The world is modelled in METERS with y UP (ground = 0);
 * the renderer flips/scales to pixels. All physics numbers are here so playtest
 * tuning never touches sim code.
 */

/** Course length; the arched finish line stands at this x. */
export const COURSE_M = 5;
export const FINISH_X_M = COURSE_M;

export const LEG_COUNT = 8;
/** Each leg is 3 verlet segments of this length (total reach ~1.35 m). */
export const LEG_SEGMENT_M = 0.45;
/** Head hub spawn position. */
export const HEAD_START_X_M = 0.6;
export const BODY_HEIGHT_M = 1.1;
/** Head visual/collision radius (small enough to fit the 0.5 m hole). */
export const HEAD_R_M = 0.35;

// --- physics ---
export const GRAVITY_MPS2 = 9;
/** Constraint relaxation iterations per substep — FIXED for determinism. */
export const SOLVER_ITERATIONS = 8;
/** Physics substeps per sim tick — FIXED for determinism. */
export const SUBSTEPS = 2;
/** Verlet velocity damping per integration step (1 = none). */
export const DAMPING = 0.99;
/** Fraction of horizontal velocity removed while a point touches ground. */
export const GROUND_FRICTION = 0.7;
/** Tip within this height of ground counts as touching (plants). */
export const PLANT_EPS_M = 0.03;

// --- leg motors (per-second speeds, scaled by dt) ---
/** Horizontal push on a planted leg's upper points — this is what propels the body. */
export const SWING_PLANTED_MPS = 2.2;
/** Horizontal tip speed for a lifted (in-air) leg repositioning itself. */
export const SWING_LIFTED_MPS = 0.5;
/** Upward tip speed while the lift key is held. */
export const LIFT_MPS = 2.5;
/** A lifted tip may not rise closer to the head than this (tentacles can't go above the shoulder). */
export const LIFT_TIP_BELOW_HEAD_M = 0.2;

/** Head center below -this ⇒ round failed (only reachable over the hole). */
export const HEAD_DROP_FAIL_M = 0.5;
/** Points may not leave the course strip horizontally. */
export const X_MIN_M = -1;
export const X_MAX_M = COURSE_M + 2;

// --- rendering ---
export const SQUID_PX_PER_M = 110;

// --- score sanity bounds (shared by client + server validation) ---
export const MIN_SCORE_MS = 3000;
export const MAX_SCORE_MS = 30 * 60 * 1000;
