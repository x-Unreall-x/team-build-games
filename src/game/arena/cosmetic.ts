/**
 * Cosmetic-only player identity. Legacy shape ids now select fighter artwork; avatar photos are
 * layered over the fighter's head. Carried on the wire and drawn
 * by the renderer, but NEVER read by the sim core — purely visual, so it can't affect determinism.
 * `coerceShape` is the wire trust boundary (a peer can only ever send a known shape), mirroring
 * `protocol.coerceIntent`.
 */

export type Shape = "circle" | "square" | "triangle" | "diamond";

export const SHAPES: Shape[] = ["circle", "square", "triangle", "diamond"];

export const DEFAULT_SHAPE: Shape = "circle";

export function coerceShape(raw: unknown): Shape {
  return SHAPES.includes(raw as Shape) ? (raw as Shape) : DEFAULT_SHAPE;
}
