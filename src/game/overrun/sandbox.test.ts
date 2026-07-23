import { describe, expect, it } from "vitest";
import { parseOverrunSandboxConfig, createOverrunSandboxWorld } from "./sandbox";
import { krakenHp, ENEMIES } from "./enemies";

const parse = (q: string) => parseOverrunSandboxConfig(new URLSearchParams(q));

describe("parseOverrunSandboxConfig", () => {
  it("defaults to a small rusher pack with AI on when nothing is specified", () => {
    const c = parse("");
    expect(c.kinds).toEqual(["rusher"]);
    expect(c.count).toBeGreaterThanOrEqual(1);
    expect(c.ai).toBe(true);
    expect(c.hp).toBe(null);
  });

  it("parses a comma list of kinds, dropping unknowns, and accepts the kraken", () => {
    expect(parse("enemy=kraken,tank,banana,spitter").kinds).toEqual(["kraken", "tank", "spitter"]);
    expect(parse("enemy=nonsense").kinds).toEqual(["rusher"]); // all invalid → default
  });

  it("reads ai=off, count, hp, and gun (clamped/coerced)", () => {
    expect(parse("ai=off").ai).toBe(false);
    expect(parse("count=5").count).toBe(5);
    expect(parse("count=999").count).toBeLessThanOrEqual(24);
    expect(parse("count=0").count).toBe(1);
    expect(parse("hp=250").hp).toBe(250);
    expect(parse("hp=-4").hp).toBe(null);
    expect(parse("gun=shotgun").gun).toBe("shotgun");
    expect(parse("gun=bogus").gun).toBe(parse("").gun); // falls back to the default gun
  });
});

describe("createOverrunSandboxWorld", () => {
  it("drops in a single local player with the chosen gun and no wave machinery running", () => {
    const w = createOverrunSandboxWorld(parse("gun=dmr&enemy=tank&count=1"));
    expect(Object.keys(w.players)).toEqual(["you"]);
    expect(w.players.you!.gun).toBe("dmr");
    expect(w.phase).toBe("playing");
    expect(w.pending).toEqual([]); // no queued spawns
    expect(w.wave).toBe(1); // non-zero so the sim never composes a fresh wave
  });

  it("places `count` enemies, cycling through the chosen kinds", () => {
    const w = createOverrunSandboxWorld(parse("enemy=rusher,tank&count=4"));
    expect(w.enemies).toHaveLength(4);
    expect(w.enemies.map((e) => e.kind)).toEqual(["rusher", "tank", "rusher", "tank"]);
  });

  it("scales a Kraken's HP to a solo party and initializes its attack timer", () => {
    const w = createOverrunSandboxWorld(parse("enemy=kraken&count=1"));
    const boss = w.enemies[0]!;
    expect(boss.kind).toBe("kraken");
    expect(boss.health).toBe(krakenHp(1));
    expect(boss.special).toBe("none");
    expect(boss.specialRemaining).toBeGreaterThan(0); // attack timer primed
  });

  it("honours an explicit hp override on every target", () => {
    const w = createOverrunSandboxWorld(parse("enemy=exploder&count=2&hp=15"));
    expect(w.enemies.every((e) => e.health === 15)).toBe(true);
    expect(ENEMIES.exploder.health).not.toBe(15); // proving the override, not the default
  });
});
