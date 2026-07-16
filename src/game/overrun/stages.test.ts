import { describe, expect, it } from "vitest";
import { CAMPAIGN_WAVES, TOTAL_STAGES, stageForWave, wavesForStage } from "./stages";

describe("overrun stages", () => {
  it("waves per stage follow 3 + floor((stage-1)/2)", () => {
    expect([1, 2, 3].map(wavesForStage)).toEqual([3, 3, 4]);
  });

  it("CAMPAIGN_WAVES is the sum across all stages", () => {
    expect(CAMPAIGN_WAVES).toBe(10);
    expect(TOTAL_STAGES).toBe(3);
  });

  it("maps global wave numbers onto (stage, waveInStage)", () => {
    expect(stageForWave(1)).toMatchObject({ stage: 1, waveInStage: 1, isStageLast: false });
    expect(stageForWave(3)).toMatchObject({ stage: 1, waveInStage: 3, isStageLast: true, isCampaignLast: false });
    expect(stageForWave(4)).toMatchObject({ stage: 2, waveInStage: 1 });
    expect(stageForWave(6)).toMatchObject({ stage: 2, waveInStage: 3, isStageLast: true, isCampaignLast: false });
    expect(stageForWave(7)).toMatchObject({ stage: 3, waveInStage: 1 });
    expect(stageForWave(10)).toMatchObject({ stage: 3, waveInStage: 4, isStageLast: true, isCampaignLast: true });
  });

  it("clamps waves past the campaign end to the final stage", () => {
    expect(stageForWave(99)).toMatchObject({ stage: 3, isCampaignLast: true });
  });
});
