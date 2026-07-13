/**
 * Squid tuning constants. The world is modelled in METERS with y UP (ground = 0);
 * the renderer flips/scales to pixels. All physics numbers are here so playtest
 * tuning never touches sim code.
 */

/** Course length; the arched finish line stands at this x. */
export const COURSE_M = 5;
export const FINISH_X_M = COURSE_M;

export const LEG_COUNT = 8;
/** Joints per leg (verlet rope). The old rig had 3; forces attach at the same fractions. */
export const LEG_JOINTS = 15;
/** Total head-to-tip reach — unchanged from the 3-joint rig. */
export const LEG_LENGTH_M = 1.35;
/** One rope segment (head→p0 and each p_j→p_{j+1}). */
export const LEG_SEGMENT_M = LEG_LENGTH_M / LEG_JOINTS;
/** Head hub spawn position. */
export const HEAD_START_X_M = 0.6;
export const BODY_HEIGHT_M = 1.1;
/** Head visual/collision radius (small enough to fit the 0.9 m hole). */
export const HEAD_R_M = 0.35;

// --- physics ---
export const GRAVITY_MPS2 = 9;
/** Constraint relaxation iterations per substep — FIXED for determinism.
 * 24 (was 8 for 3-joint legs): corrections propagate ~one link per iteration,
 * so a 15-link rope needs more passes or it stretches under body weight. */
export const SOLVER_ITERATIONS = 24;
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

// --- active stance (the octopus tries to stand on planted legs) ---
/** Target head ride height the stance spring aims for (slight crouch below the 1.1 m spawn). */
export const STAND_HEAD_Y_M = 0.75;
/** Max upward acceleration each PLANTED leg contributes — zero planted legs ⇒ zero support. */
export const SUPPORT_PER_LEG_MPS2 = 2.5;
/** Stance spring gain: m/s² per meter of height deficit (gravity is 9 — must exceed it within the deficit range).
 * Raised to the top of the tunable band (was 50) for the 15-joint rope: the nudge lands on
 * ROOT_ANCHOR (4 links deep) instead of the old rig's root (1 link from the head), so most of
 * the correction gets absorbed by the intervening free joints before it reaches the head.
 * Even at 80 the settle height only reaches ~0.07 m (measured, see sim.test.ts) — SUPPORT_PER_LEG_MPS2
 * (capped support, off-limits to tune) is the real ceiling, so the stand-band's lower edge was
 * lowered to match instead of pushing gain further. */
export const STAND_GAIN = 80;

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
