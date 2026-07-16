/**
 * Campaign stage structure (pure). The campaign is a finite run of `TOTAL_STAGES`
 * stages; each stage is `wavesForStage(stage)` waves ("+1 wave every 2 stages",
 * baseline 3 → 3, 3, 4). Survival mode ignores all of this and runs endlessly.
 *
 * v1 keeps stages as a wave-count structure over the existing enemy roster; dedicated
 * per-stage enemy pools + bosses land in a later increment. `stageForWave` maps the
 * sim's global 1-based `wave` counter onto (stage, waveInStage) for HUD + victory.
 */

export const TOTAL_STAGES = 3;

/** Waves in a given 1-based stage: 3 + floor((stage-1)/2) → 3, 3, 4, 4, 5… */
export function wavesForStage(stage: number): number {
  return 3 + Math.floor((Math.max(1, stage) - 1) / 2);
}

/** Total waves to clear the whole campaign (sum over all stages). */
export const CAMPAIGN_WAVES = Array.from({ length: TOTAL_STAGES }, (_, i) => wavesForStage(i + 1)).reduce(
  (a, b) => a + b,
  0,
);

export interface StagePosition {
  stage: number;
  /** 1-based wave index within the stage. */
  waveInStage: number;
  /** This wave is the last of its stage (a boss wave, once bosses exist). */
  isStageLast: boolean;
  /** This wave is the final wave of the final stage — clearing it wins the campaign. */
  isCampaignLast: boolean;
}

/** Map a global 1-based wave number onto its stage + position. Clamps past the end. */
export function stageForWave(wave: number): StagePosition {
  let acc = 0;
  for (let stage = 1; stage <= TOTAL_STAGES; stage++) {
    const w = wavesForStage(stage);
    if (wave <= acc + w) {
      return {
        stage,
        waveInStage: wave - acc,
        isStageLast: wave === acc + w,
        isCampaignLast: stage === TOTAL_STAGES && wave === acc + w,
      };
    }
    acc += w;
  }
  const last = wavesForStage(TOTAL_STAGES);
  return { stage: TOTAL_STAGES, waveInStage: last, isStageLast: true, isCampaignLast: true };
}
