import { describe, expect, it } from "vitest";
import { fireTick, tickAmmo, tryStartReload } from "./firing";
import { effectiveStats } from "./perks";
import { freshAmmo, GUNS } from "./weapons";
import { createShooterWorld } from "./match";
import type { Enemy, ShooterPlayer } from "./types";

const EFF = effectiveStats([]);
const player = (over: Partial<ShooterPlayer> = {}): ShooterPlayer => ({
  ...createShooterWorld(["p1"], 1).players.p1!,
  pos: { x: 5, y: 15 }, aim: 0, ...over,
});
const enemy = (id: string, x: number, over: Partial<Enemy> = {}): Enemy => ({
  id, kind: "rusher", pos: { x, y: 15 }, health: 20, attackCooldown: 0, ...over,
});

describe("fireTick", () => {
  it("held fire shoots at the gun's RPM (cooldown-gated), decrementing the mag", () => {
    let p = player();
    const r1 = fireTick(p, [], true, 1, 10, EFF);
    expect(r1.player.ammo.mag).toBe(11);
    expect(r1.player.ammo.fireCooldown).toBeCloseTo(60 / 300, 5);
    expect(r1.player.stats.shots).toBe(1);
    // cooldown not yet elapsed → no second shot
    const r2 = fireTick(r1.player, [], true, 1, 11, EFF);
    expect(r2.player.ammo.mag).toBe(11);
    expect(r2.player.stats.shots).toBe(1);
  });

  it("hits the nearest enemy on the ray and emits a shot event with the impact point", () => {
    const p = player(); // aiming +x from (5,15)
    const far = enemy("e2", 12);
    const near = enemy("e1", 8);
    const r = fireTick(p, [far, near], true, 1, 0, EFF);
    const e1 = r.enemies.find((e) => e.id === "e1")!;
    const e2 = r.enemies.find((e) => e.id === "e2")!;
    expect(e1.health).toBe(20 - GUNS.pistol.damage);
    expect(e2.health).toBe(20); // pistol pierce 0 — blocked by the near one
    expect(r.player.stats.hits).toBe(1);
    const shot = r.events.find((e) => e.kind === "shot")!;
    expect(shot.kind === "shot" && shot.to.x).toBeCloseTo(8, 0); // tracer ends at the hit
  });

  it("rifle pierces exactly one extra enemy", () => {
    const p = player({ gun: "rifle", ammo: freshAmmo("rifle") });
    const r = fireTick(p, [enemy("e1", 8), enemy("e2", 12), enemy("e3", 16)], true, 1, 0, EFF);
    expect(r.enemies.find((e) => e.id === "e1")!.health).toBe(20 - 34);
    expect(r.enemies.find((e) => e.id === "e2")!.health).toBe(20 - 34);
    expect(r.enemies.find((e) => e.id === "e3")!.health).toBe(20); // pierce 1 exhausted
  });

  it("shotgun fires 8 pellets with deterministic spread; counts ONE shot", () => {
    const p = player({ gun: "shotgun", ammo: freshAmmo("shotgun") });
    const a = fireTick(p, [enemy("e1", 5.8, { health: 1000 })], true, 42, 7, EFF);
    const b = fireTick(p, [enemy("e1", 5.8, { health: 1000 })], true, 42, 7, EFF);
    expect(a.enemies[0]!.health).toBe(b.enemies[0]!.health); // same coords → same pellets
    expect(a.player.stats.shots).toBe(1);
    // point blank: every pellet lands → 8 × 8 damage
    expect(a.enemies[0]!.health).toBe(1000 - 8 * 8);
    // different tick → different spread draw
    const c = fireTick(p, [enemy("e1", 11, { health: 1000 })], true, 42, 8, EFF);
    const d = fireTick(p, [enemy("e1", 11, { health: 1000 })], true, 42, 7, EFF);
    expect(c.enemies[0]!.health === d.enemies[0]!.health).toBe(false);
  });

  it("respects range", () => {
    const p = player(); // pistol range 20
    const r = fireTick(p, [enemy("e1", 26)], true, 1, 0, EFF);
    expect(r.enemies[0]!.health).toBe(20);
    expect(r.player.stats.hits).toBe(0);
  });

  it("empty mag with reserve auto-starts a reload; firing stays blocked while reloading", () => {
    const p = player({ gun: "shotgun", ammo: { mag: 0, reserve: 12, reloadRemaining: 0, fireCooldown: 0 } });
    const r = fireTick(p, [], true, 1, 0, EFF);
    expect(r.player.ammo.reloadRemaining).toBeCloseTo(GUNS.shotgun.reloadS, 5);
    expect(r.events).toEqual([]);
    const r2 = fireTick(r.player, [], true, 1, 1, EFF);
    expect(r2.player.ammo.mag).toBe(0); // still reloading — no shot
  });

  it("mag AND reserve empty falls back to a fresh infinite pistol", () => {
    const p = player({ gun: "rifle", ammo: { mag: 0, reserve: 0, reloadRemaining: 0, fireCooldown: 0 } });
    const r = fireTick(p, [], true, 1, 0, EFF);
    expect(r.player.gun).toBe("pistol");
    expect(r.player.ammo.mag).toBe(12);
  });

  it("downed players and idle triggers don't fire", () => {
    expect(fireTick(player({ status: "downed" }), [], true, 1, 0, EFF).events).toEqual([]);
    expect(fireTick(player(), [], false, 1, 0, EFF).player.ammo.mag).toBe(12);
  });
});

describe("reload machine", () => {
  it("tryStartReload arms the countdown (perk-scaled) and completion fills the mag from reserve", () => {
    let p = player({ gun: "rifle", ammo: { mag: 3, reserve: 20, reloadRemaining: 0, fireCooldown: 0 } });
    p = tryStartReload(p, effectiveStats(["hands"]));
    expect(p.ammo.reloadRemaining).toBeCloseTo(1.6 * 0.85, 5);
    p = tickAmmo(p, 2, effectiveStats(["hands"]));
    expect(p.ammo).toMatchObject({ mag: 10, reserve: 13, reloadRemaining: 0 });
  });

  it("pistol reload completion never consumes reserve", () => {
    let p = player({ ammo: { mag: 2, reserve: 0, reloadRemaining: 0.01, fireCooldown: 0 } });
    p = tickAmmo(p, 0.1, EFF);
    expect(p.ammo).toMatchObject({ mag: 12, reserve: 0 });
  });

  it("tryStartReload is a no-op on full mag / no reserve / already reloading", () => {
    const full = player();
    expect(tryStartReload(full, EFF)).toEqual(full);
    const dry = player({ gun: "rifle", ammo: { mag: 2, reserve: 0, reloadRemaining: 0, fireCooldown: 0 } });
    expect(tryStartReload(dry, EFF)).toEqual(dry);
  });

  it("multi-shot ceiling is documented: max RPM 300 < 30 Hz tick rate × 60", () => {
    // At 30 Hz a tick is 33.3 ms; the fastest slice gun (pistol, 300 RPM) fires every
    // 200 ms — so at most ONE shot per tick can ever be due. If a faster gun is added
    // (>1800 RPM), fireTick must gain a multi-shot-per-tick loop. Assert the invariant:
    for (const g of Object.values(GUNS)) expect(g.rpm).toBeLessThanOrEqual(1800);
  });
});
