/**
 * Overrun's fake-2.5D Phaser scene. The sim stays flat top-down in meters; we
 * foreshorten y by Y_SCALE and y-sort by world y for the 2.5D look. EVERY texture
 * is generated procedurally in create() (Graphics + generateTexture) — no asset
 * loads. Military/red-alert palette: camo soldiers, red rushers, slate tanks.
 */

import Phaser from "phaser";
import { OVERRUN_FIELD_M, PLAYER_RADIUS_M, REVIVE_S } from "../constants";
import { ENEMIES } from "../enemies";
import { GUNS } from "../weapons";
import { effectiveStats, xpToNext } from "../perks";
import type {
  EnemyKind, GunId, PickupKind, PlayerId, RawShooterInput, ShooterEvent, ShooterWorld, Vec2,
} from "../types";
import { screenDeltaToWorldAngle } from "./aim";
import { createShooterKeyboard, type ShooterKeyboardReader } from "./keyboard";
import type { OverrunConfig, OverrunHudState } from "./contract";

export type { OverrunConfig, OverrunDriver, OverrunEvent, OverrunHudState, OverrunMeta, TeammateHud } from "./contract";

// ---- 2.5D render constants (local — Overrun shares no constants with arena) --
const PX_PER_M = 28;
const MARGIN_X = 56;
const OFFSET_Y = 109;
const BOTTOM_PAD = 98;
const Y_SCALE = 0.62;
const FIELD_PX = OVERRUN_FIELD_M * PX_PER_M;
const PLAYER_R = PLAYER_RADIUS_M * PX_PER_M;

export const OVERRUN_WIDTH = MARGIN_X * 2 + FIELD_PX;
export const OVERRUN_HEIGHT = OFFSET_Y + FIELD_PX * Y_SCALE + BOTTOM_PAD;

const sx = (xm: number) => MARGIN_X + xm * PX_PER_M;
const sy = (ym: number) => OFFSET_Y + ym * PX_PER_M * Y_SCALE;

/** World aim angle → on-screen rotation on the foreshortened ground plane. */
const screenAngle = (aim: number) => Math.atan2(Math.sin(aim) * Y_SCALE, Math.cos(aim));

// ---- palette ------------------------------------------------------------------
const CAMO_BODY = 0x3f6212;
/** 8 distinct squad ring colors, indexed by colorIndex. */
const RING_COLORS = [0xf8fafc, 0xfbbf24, 0x38bdf8, 0xf472b6, 0xa3e635, 0xc084fc, 0xfb923c, 0x2dd4bf];
const GUN_TINT: Record<GunId, number> = { pistol: 0xd4d4d8, shotgun: 0xf59e0b, rifle: 0x38bdf8 };
const DOWNED_TINT = 0x64748b;
const TRACER_COLOR: Record<GunId, number> = { pistol: 0xfef9c3, shotgun: 0xfbbf24, rifle: 0x7dd3fc };

const FLOOR_TEXTURE = "overrun-floor";
const GUN_TEXTURE = "overrun-gun";
const soldierTexture = (colorIndex: number) => `overrun-soldier-${colorIndex % RING_COLORS.length}`;
const enemyTexture = (kind: EnemyKind) => `overrun-enemy-${kind}`;
const pickupTexture = (kind: PickupKind) => (kind === "medkit" ? "overrun-medkit" : "overrun-gunbox");

interface PlayerView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  gun: Phaser.GameObjects.Image;
  /** White revive-progress ring shown while downed. */
  arc: Phaser.GameObjects.Graphics;
}

interface PickupView {
  container: Phaser.GameObjects.Container;
  /** Random-ish phase so bobbing pickups don't move in lockstep. */
  phase: number;
}

export class OverrunScene extends Phaser.Scene {
  private cfg!: OverrunConfig;
  private keyboard!: ShooterKeyboardReader;
  private views: Record<PlayerId, PlayerView> = {};
  private enemyViews: Record<string, Phaser.GameObjects.Image> = {};
  private pickupViews: Record<string, PickupView> = {};
  private prev: ShooterWorld | null = null;
  private lastCountdown = 99;
  private lastProcessedTick = -1;
  private ended = false;

  constructor() {
    super("overrun");
  }

  create(): void {
    this.cfg = this.registry.get("cfg") as OverrunConfig;
    this.keyboard = createShooterKeyboard(this);
    this.makeTextures();
    this.drawField();
  }

  override update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);
    const input = this.buildInput();
    const { world, countdown } = this.cfg.driver.frame(dt, input);

    this.fireCountdownSfx(countdown);
    this.processEvents(world);
    this.renderPlayers(world);
    this.renderEnemies(world);
    this.renderPickups(world);
    this.emitHud(world, countdown);

    if (world.phase === "ended" && !this.ended) {
      this.ended = true;
      this.cfg.onEvent({ type: "gameover" });
      this.cfg.onEnd(world);
    }
    this.prev = world;
  }

  // ---- input --------------------------------------------------------------------

  private buildInput(): RawShooterInput {
    const p = this.input.activePointer;
    const raw: RawShooterInput = { ...this.keyboard.read(), fire: p.isDown };
    // Mouse aim: angle from the local player to the pointer (un-projecting the 2.5D y-squash).
    const me = this.prev?.players[this.cfg.driver.localId];
    if (me && me.status === "alive") {
      const dx = p.x - sx(me.pos.x);
      const dy = p.y - sy(me.pos.y);
      if (dx !== 0 || dy !== 0) raw.aim = screenDeltaToWorldAngle(dx, dy, Y_SCALE);
    }
    return raw;
  }

  // ---- events / SFX ---------------------------------------------------------------

  private fireCountdownSfx(countdown: number): void {
    if (countdown < this.lastCountdown && countdown >= 0 && this.lastCountdown <= 3) {
      this.cfg.onEvent(countdown > 0 ? { type: "tik", n: countdown } : { type: "go" });
    }
    this.lastCountdown = countdown;
  }

  /**
   * World events ride snapshots and linger for a few ticks (EVENT_TTL_TICKS), so the same
   * event is re-delivered across frames — only process ticks newer than the last one seen.
   */
  private processEvents(world: ShooterWorld): void {
    let maxTick = this.lastProcessedTick;
    for (const ev of world.events) {
      if (ev.tick <= this.lastProcessedTick) continue;
      if (ev.tick > maxTick) maxTick = ev.tick;
      this.handleEvent(ev, world);
    }
    this.lastProcessedTick = maxTick;
  }

  private handleEvent(ev: ShooterEvent, world: ShooterWorld): void {
    const localId = this.cfg.driver.localId;
    switch (ev.kind) {
      case "shot":
        this.drawTracer(ev.from, ev.to, ev.gun);
        // SFX only for the local player's own shots (volume sanity in a full squad).
        if (this.isLocalShot(ev.from, world)) this.cfg.onEvent({ type: "shot" });
        break;
      case "kill":
        this.cfg.onEvent({ type: "kill" });
        break;
      case "pickup":
        this.cfg.onEvent({ type: "pickup" });
        break;
      case "levelup":
        this.cfg.onEvent({ type: "levelup" });
        break;
      case "downed":
        this.cfg.onEvent({ type: "downed", local: ev.playerId === localId });
        break;
      case "revived":
        this.cfg.onEvent({ type: "revived" });
        break;
    }
  }

  /** Shot events carry no playerId — attribute by whichever player is nearest the muzzle. */
  private isLocalShot(from: Vec2, world: ShooterWorld): boolean {
    let bestId: PlayerId | null = null;
    let bestD = Infinity;
    for (const p of Object.values(world.players)) {
      const d = Math.hypot(p.pos.x - from.x, p.pos.y - from.y);
      if (d < bestD) {
        bestD = d;
        bestId = p.id;
      }
    }
    return bestId === this.cfg.driver.localId;
  }

  /** One-frame tracer: a fading line from muzzle to impact + a small muzzle flash dot. */
  private drawTracer(from: Vec2, to: Vec2, gun: GunId): void {
    const g = this.add.graphics().setDepth(from.y + 0.01);
    g.setAlpha(0.7);
    g.lineStyle(gun === "rifle" ? 2 : 1.5, TRACER_COLOR[gun], 1);
    g.beginPath();
    g.moveTo(sx(from.x), sy(from.y));
    g.lineTo(sx(to.x), sy(to.y));
    g.strokePath();
    g.fillStyle(0xfff7ed, 1);
    g.fillCircle(sx(from.x), sy(from.y), 3);
    this.tweens.add({ targets: g, alpha: 0, duration: 80, onComplete: () => g.destroy() });
  }

  // ---- rendering ------------------------------------------------------------------

  private renderPlayers(world: ShooterWorld): void {
    for (const p of Object.values(world.players)) {
      const v = this.views[p.id] ?? (this.views[p.id] = this.makePlayerView(p.id));

      if (p.status === "dead") {
        v.container.setVisible(false);
        continue;
      }
      v.container.setVisible(true);
      v.container.setPosition(sx(p.pos.x), sy(p.pos.y));
      v.container.setDepth(p.pos.y);
      v.gun.setRotation(screenAngle(p.aim));
      v.gun.setTint(GUN_TINT[p.gun]);

      if (p.status === "downed") {
        v.body.setTint(DOWNED_TINT);
        v.gun.setVisible(false);
        this.drawReviveArc(v.arc, p.reviveProgress / REVIVE_S);
      } else {
        v.body.clearTint();
        v.gun.setVisible(true);
        v.arc.clear();
      }
    }
  }

  private drawReviveArc(g: Phaser.GameObjects.Graphics, fraction: number): void {
    const f = Math.max(0, Math.min(1, fraction));
    g.clear();
    g.lineStyle(3, 0xffffff, 0.9);
    g.beginPath();
    g.arc(0, 0, PLAYER_R + 5, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
    g.strokePath();
  }

  private renderEnemies(world: ShooterWorld): void {
    const live = new Set<string>();
    for (const e of world.enemies) {
      live.add(e.id);
      let img = this.enemyViews[e.id];
      if (!img) {
        img = this.add.image(0, 0, enemyTexture(e.kind));
        this.enemyViews[e.id] = img;
      }
      img.setPosition(sx(e.pos.x), sy(e.pos.y));
      img.setDepth(e.pos.y);
    }
    for (const id of Object.keys(this.enemyViews)) {
      if (live.has(id)) continue;
      const img = this.enemyViews[id]!;
      delete this.enemyViews[id];
      // Kill pop: quick fade + shrink, then free the sprite.
      this.tweens.add({
        targets: img,
        alpha: 0,
        scale: 1.4,
        duration: 150,
        onComplete: () => img.destroy(),
      });
    }
  }

  private renderPickups(world: ShooterWorld): void {
    const live = new Set<string>();
    const t = this.time.now / 1000; // render-only wall clock: purely cosmetic bob
    for (const pk of world.pickups) {
      live.add(pk.id);
      const v = this.pickupViews[pk.id] ?? (this.pickupViews[pk.id] = this.makePickupView(pk.id, pk.kind));
      const bob = Math.sin(t * 3 + v.phase) * 2.5;
      v.container.setPosition(sx(pk.pos.x), sy(pk.pos.y) + bob);
      v.container.setDepth(pk.pos.y);
    }
    for (const id of Object.keys(this.pickupViews)) {
      if (!live.has(id)) {
        this.pickupViews[id]!.container.destroy();
        delete this.pickupViews[id];
      }
    }
  }

  private emitHud(world: ShooterWorld, countdown: number): void {
    const local = world.players[this.cfg.driver.localId];
    if (!local) return;
    const gunDef = GUNS[local.gun];
    const hud: OverrunHudState = {
      countdown,
      health: local.health,
      maxHealth: effectiveStats(local.perks).maxHealth,
      status: local.status,
      gun: local.gun,
      mag: local.ammo.mag,
      reserve: gunDef.reserveMax === null ? null : local.ammo.reserve,
      reloadFraction: Math.max(0, Math.min(1, local.ammo.reloadRemaining / gunDef.reloadS)),
      wave: world.wave,
      intermission: world.intermission,
      score: world.score,
      xp: local.xp,
      xpNext: xpToNext(local.level),
      level: local.level,
      offer: local.offers[0] ?? null,
      offersQueued: local.offers.length,
      kills: local.stats.kills,
      teammates: Object.values(world.players)
        .filter((p) => p.id !== local.id)
        .map((p) => {
          const meta = this.cfg.driver.getMeta(p.id);
          return { id: p.id, name: meta.name, colorIndex: meta.colorIndex, status: p.status, health: p.health };
        }),
    };
    this.cfg.onHud(hud);
  }

  // ---- setup ------------------------------------------------------------------------

  private makePlayerView(id: PlayerId): PlayerView {
    const meta = this.cfg.driver.getMeta(id);
    const shadow = this.add.ellipse(0, PLAYER_R * 0.55, PLAYER_R * 2.1, PLAYER_R * 0.8, 0x000000, 0.28);
    const body = this.add.image(0, 0, soldierTexture(meta.colorIndex));
    const gun = this.add.image(0, 0, GUN_TEXTURE).setOrigin(0.15, 0.5).setTint(GUN_TINT.pistol);
    const arc = this.add.graphics();
    const children: Phaser.GameObjects.GameObject[] = [shadow, body, gun, arc];
    if (id !== this.cfg.driver.localId) {
      const name = this.add
        .text(0, PLAYER_R + 6, meta.name, {
          fontFamily: "monospace",
          fontSize: "9px",
          color: "#e5e7eb",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5, 0)
        .setResolution(2);
      children.push(name);
    }
    const container = this.add.container(0, 0, children);
    return { container, body, gun, arc };
  }

  private makePickupView(id: string, kind: PickupKind): PickupView {
    const img = this.add.image(0, 0, pickupTexture(kind));
    const children: Phaser.GameObjects.GameObject[] = [img];
    if (kind !== "medkit") {
      const glyph = this.add
        .text(0, 0, kind === "shotgun" ? "S" : "R", { fontFamily: "monospace", fontSize: "7px", color: "#451a03", fontStyle: "bold" })
        .setOrigin(0.5)
        .setResolution(2);
      children.push(glyph);
    }
    const container = this.add.container(0, 0, children);
    // Deterministic-enough phase from the id so bobs desync (render-only).
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
    return { container, phase: (h / 0xffff) * Math.PI * 2 };
  }

  // ---- procedural textures ------------------------------------------------------------

  private makeTextures(): void {
    this.makeFloorTexture();
    for (let c = 0; c < RING_COLORS.length; c++) this.makeSoldierTexture(c);
    this.makeGunTexture();
    this.makeEnemyTextures();
    this.makePickupTextures();
  }

  private makeFloorTexture(): void {
    const w = FIELD_PX;
    const h = Math.ceil(FIELD_PX * Y_SCALE);
    const g = this.add.graphics();
    g.fillStyle(0x181c16, 1); // near-black olive: military night-ops ground
    g.fillRect(0, 0, w, h);
    g.lineStyle(1, 0x2a3324, 0.5); // subtle camo-green grid
    const cell = PX_PER_M * 2;
    for (let x = 0; x <= w; x += cell) g.lineBetween(x, 0, x, h);
    for (let y = 0; y <= h; y += cell * Y_SCALE) g.lineBetween(0, y, w, y);
    g.generateTexture(FLOOR_TEXTURE, w, h);
    g.destroy();
  }

  private makeSoldierTexture(colorIndex: number): void {
    const r = PLAYER_R;
    const g = this.add.graphics();
    g.fillStyle(RING_COLORS[colorIndex]!, 1); // squad ring
    g.fillCircle(r, r, r);
    g.fillStyle(CAMO_BODY, 1); // camo-green body
    g.fillCircle(r, r, r - 3);
    g.fillStyle(0x365314, 1); // helmet shading
    g.fillCircle(r, r - r * 0.15, r * 0.45);
    g.generateTexture(soldierTexture(colorIndex), Math.ceil(r * 2), Math.ceil(r * 2));
    g.destroy();
  }

  private makeGunTexture(): void {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1); // white — tinted per gun at render time
    g.fillRect(0, 0, 18, 5);
    g.generateTexture(GUN_TEXTURE, 18, 5);
    g.destroy();
  }

  private makeEnemyTextures(): void {
    const rr = ENEMIES.rusher.radius * PX_PER_M;
    const rg = this.add.graphics();
    rg.fillStyle(0xef4444, 1); // rusher: alarm red
    rg.fillCircle(rr, rr, rr);
    rg.fillStyle(0xfca5a5, 1);
    rg.fillCircle(rr, rr - rr * 0.25, rr * 0.3);
    rg.generateTexture(enemyTexture("rusher"), Math.ceil(rr * 2), Math.ceil(rr * 2));
    rg.destroy();

    const tr = ENEMIES.tank.radius * PX_PER_M;
    const tg = this.add.graphics();
    tg.fillStyle(0x1e293b, 1); // darker rim
    tg.fillCircle(tr, tr, tr);
    tg.fillStyle(0x334155, 1); // tank: heavy slate
    tg.fillCircle(tr, tr, tr - 4);
    tg.fillStyle(0x475569, 1);
    tg.fillCircle(tr, tr, tr * 0.35);
    tg.generateTexture(enemyTexture("tank"), Math.ceil(tr * 2), Math.ceil(tr * 2));
    tg.destroy();
  }

  private makePickupTextures(): void {
    const s = 16;
    const mg = this.add.graphics();
    mg.fillStyle(0xf8fafc, 1); // medkit: white rounded square + red cross
    mg.fillRoundedRect(0, 0, s, s, 4);
    mg.fillStyle(0xdc2626, 1);
    mg.fillRect(s / 2 - 2, 3, 4, s - 6);
    mg.fillRect(3, s / 2 - 2, s - 6, 4);
    mg.generateTexture(pickupTexture("medkit"), s, s);
    mg.destroy();

    const gg = this.add.graphics();
    gg.fillStyle(0xf59e0b, 1); // gun crate: amber square (the "S"/"R" glyph is a Text child)
    gg.fillRoundedRect(0, 0, s, s, 3);
    gg.lineStyle(1, 0x92400e, 1);
    gg.strokeRoundedRect(0.5, 0.5, s - 1, s - 1, 3);
    gg.generateTexture(pickupTexture("shotgun"), s, s);
    gg.destroy();
  }

  private drawField(): void {
    const h = FIELD_PX * Y_SCALE;
    this.add
      .image(MARGIN_X + FIELD_PX / 2, OFFSET_Y + h / 2, FLOOR_TEXTURE)
      .setDisplaySize(FIELD_PX, h)
      .setDepth(-1001);
    this.add
      .rectangle(MARGIN_X + FIELD_PX / 2, OFFSET_Y + h / 2, FIELD_PX, h)
      .setStrokeStyle(2, 0xb91c1c, 0.8) // red-alert perimeter
      .setDepth(-1000);
  }
}
