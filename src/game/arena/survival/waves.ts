import { survivalRandom } from "./rng";

export type SurvivalEnemyKind = "crawler";

export interface PlannedEnemySpawn {
  id: string;
  kind: SurvivalEnemyKind;
  /** Tick relative to the start of this wave. */
  atTick: number;
  /** Angle around the arena perimeter in radians. */
  angle: number;
}

export interface SurvivalWavePlan {
  level: number;
  wave: number;
  partySize: number;
  spawns: PlannedEnemySpawn[];
}

export const MAX_CONCURRENT_ENEMIES = 64;

/** Sub-linear party scaling keeps larger groups busy without multiplying the horde eightfold. */
export function waveEnemyCount(level: number, wave: number, partySize: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  const safeWave = Math.max(1, Math.floor(wave));
  const safeParty = Math.max(1, Math.floor(partySize));
  const base = 3 + safeLevel * 2 + safeWave;
  return Math.min(MAX_CONCURRENT_ENEMIES, Math.ceil(base * safeParty ** 0.8));
}

/** Pure deterministic plan. Call order elsewhere cannot alter these spawn decisions. */
export function wavePlan(
  seed: number,
  level: number,
  wave: number,
  partySize: number,
): SurvivalWavePlan {
  const frozenPartySize = Math.max(1, Math.floor(partySize));
  const count = waveEnemyCount(level, wave, frozenPartySize);
  const spacingTicks = Math.max(6, 18 - Math.max(1, level));
  const spawns = Array.from({ length: count }, (_, index): PlannedEnemySpawn => {
    const id = `e${level}-${wave}-${index}`;
    return {
      id,
      kind: "crawler",
      atTick: index * spacingTicks,
      angle: survivalRandom(seed, index, id, "spawn-angle") * Math.PI * 2,
    };
  });
  return { level, wave, partySize: frozenPartySize, spawns };
}
