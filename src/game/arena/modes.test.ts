import { describe, expect, it } from "vitest";
import { coerceMode, DEFAULT_MODE, MODES, modeInfo } from "./modes";

describe("game modes registry", () => {
  it("names the four modes with unique ids", () => {
    expect(MODES.map((m) => m.id)).toEqual(["ffa", "labyrinth", "coop-survival", "team-versus"]);
    expect(MODES.map((m) => m.name)).toEqual(["Free For All", "Labyrinth", "Coop Survival", "Team Versus"]);
  });

  it("only Free For All is available today; the rest are 'soon'", () => {
    expect(MODES.filter((m) => m.available).map((m) => m.id)).toEqual(["ffa"]);
  });

  it("maps each mode to its rules + arena axes", () => {
    expect(modeInfo("labyrinth")).toMatchObject({ rules: "versus", arena: "labyrinth" });
    expect(modeInfo("coop-survival")).toMatchObject({ rules: "survival", arena: "open" });
    expect(modeInfo("team-versus")).toMatchObject({ rules: "team" });
  });

  it("coerceMode narrows untrusted input, defaulting to FFA", () => {
    expect(coerceMode("coop-survival")).toBe("coop-survival");
    expect(coerceMode("nonsense")).toBe(DEFAULT_MODE);
    expect(coerceMode(undefined)).toBe("ffa");
  });
});
