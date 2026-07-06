import Phaser from "phaser";
import {
  ATTACK_TTL_S,
  FIELD_M,
  FIGURE_RADIUS_M,
  PX_PER_M,
  SWORD_REACH_M,
} from "../../constants";
import { WEAPONS } from "../weapons";
import type { PlayerId, World } from "../types";
import { dashCooldownFraction } from "../dash";
import { attackCooldownFraction } from "../combat";
import { directionVector } from "../logic";
import { createKeyboard, type KeyboardReader } from "../input/keyboard";
import { screenDeltaToWorldAngle } from "../input/mouse";
import { SHAPES, type Shape } from "../cosmetic";
import type { ArenaEvent, HudState, MatchDriver } from "./contract";

export type { ArenaEvent, HudState, PlayerMeta, MatchDriver } from "./contract";

const bodyTexture = (shape: Shape) => `musa-body-${shape}`;

// ---- 2.5D render constants (the sim stays flat top-down in meters) -----------
const MARGIN_X = 40;
const OFFSET_Y = 78;
const Y_SCALE = 0.62;
const VIS_R = FIGURE_RADIUS_M * PX_PER_M; // drawn body == physical body
const FIELD_PX = FIELD_M * PX_PER_M;

export const ARENA_WIDTH = MARGIN_X * 2 + FIELD_PX;
export const ARENA_HEIGHT = OFFSET_Y + FIELD_PX * Y_SCALE + 70;

/** 8-color player palette (musa tints). */
export const PALETTE = [
  0x38bdf8, 0xf472b6, 0xa3e635, 0xfbbf24, 0xc084fc, 0xfb7185, 0x34d399, 0xf97316,
];

export interface ArenaConfig {
  driver: MatchDriver;
  onHud: (h: HudState) => void;
  onEvent: (e: ArenaEvent) => void;
  onEnd: (winnerId: PlayerId | null) => void;
}

interface PlayerView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  face: Phaser.GameObjects.Image;
  sword: Phaser.GameObjects.Rectangle;
  pips: Phaser.GameObjects.Rectangle[];
  deadAnimated: boolean;
}

const sx = (xm: number) => MARGIN_X + xm * PX_PER_M;
const sy = (ym: number) => OFFSET_Y + ym * PX_PER_M * Y_SCALE;

export class ArenaScene extends Phaser.Scene {
  private cfg!: ArenaConfig;
  private keyboard!: KeyboardReader;
  private views: Record<PlayerId, PlayerView> = {};
  private prev: World | null = null;
  private lastCountdown = 99;
  private ended = false;

  constructor() {
    super("arena");
  }

  create(): void {
    this.cfg = this.registry.get("cfg") as ArenaConfig;
    this.keyboard = createKeyboard(this);
    this.makeTextures();
    this.drawField();
  }

  override update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);
    const raw = this.keyboard.read();
    // Mouse aim: angle from the local player to the pointer (un-projecting the 2.5D y-squash).
    const me = this.prev?.players[this.cfg.driver.localId];
    if (me && me.status === "alive") {
      const p = this.input.activePointer;
      const dx = p.x - sx(me.pos.x);
      const dy = p.y - sy(me.pos.y);
      if (dx !== 0 || dy !== 0) raw.aim = screenDeltaToWorldAngle(dx, dy, Y_SCALE);
    }
    const { world, countdown } = this.cfg.driver.frame(dt, raw);

    this.fireCountdownSfx(countdown);
    this.diffEvents(this.prev, world);
    this.render(world);
    this.emitHud(world, countdown);

    if (world.phase === "ended" && !this.ended) {
      this.ended = true;
      this.cfg.onEnd(world.winnerId);
    }
    this.prev = world;
  }

  // ---- events / SFX (derived from world diffs) --------------------------------

  private fireCountdownSfx(countdown: number): void {
    if (countdown < this.lastCountdown && countdown >= 0 && this.lastCountdown <= 3) {
      this.cfg.onEvent(countdown > 0 ? { type: "tik", n: countdown } : { type: "go" });
    }
    this.lastCountdown = countdown;
  }

  private diffEvents(prev: World | null, world: World): void {
    if (!prev) return;
    const localId = this.cfg.driver.localId;
    for (const p of Object.values(world.players)) {
      const before = prev.players[p.id];
      if (!before) continue;
      const isLocal = p.id === localId;
      if (isLocal && !before.dash.dashing && p.dash.dashing) this.cfg.onEvent({ type: "dash" });
      if (isLocal && p.attackCooldownRemaining > before.attackCooldownRemaining) {
        this.cfg.onEvent({ type: "attack" });
      }
      if (p.health < before.health) this.cfg.onEvent({ type: "hit", local: isLocal });
      if (before.status === "alive" && p.status === "dead") {
        this.cfg.onEvent({ type: "death", local: isLocal });
      }
    }
  }

  // ---- rendering --------------------------------------------------------------

  private render(world: World): void {
    for (const p of Object.values(world.players)) {
      const v = this.views[p.id] ?? (this.views[p.id] = this.makeView(p.id));

      if (p.status === "dead") {
        if (!v.deadAnimated) {
          v.deadAnimated = true;
          this.playDeath(v);
        }
        continue;
      }

      v.container.setPosition(sx(p.pos.x), sy(p.pos.y));
      v.container.setDepth(p.pos.y);

      const fv = directionVector(p.facing);
      v.face.setPosition(fv.x * 4, fv.y * 3 - 4);

      // Weapon visibility: bright + animated while striking, dimmed "ready" pose along the aim
      // when the cooldown is up, hidden while recharging (so readiness is readable at a glance).
      const stats = WEAPONS[p.weapon];
      let bladeAngle: number | null = null;
      let bladeAlpha = 1;
      if (p.attack) {
        const half = stats.coneHalfAngle;
        const progress = Math.max(0, Math.min(1, 1 - p.attack.ttl / ATTACK_TTL_S));
        // Thrust weapons (spear) stab straight along the aim; others sweep the cone.
        bladeAngle = stats.thrust ? p.attack.aim : p.attack.aim - half + progress * 2 * half;
      } else if (p.attackCooldownRemaining <= 0) {
        bladeAngle = p.aim;
        bladeAlpha = 0.5;
      }
      if (bladeAngle === null) {
        v.sword.setVisible(false);
      } else {
        // Project the world-space reach onto the foreshortened ground plane (y * Y_SCALE)
        // so the blade's on-screen reach matches the real hit reach in every direction.
        const tipX = Math.cos(bladeAngle) * stats.reach * PX_PER_M;
        const tipY = Math.sin(bladeAngle) * stats.reach * PX_PER_M * Y_SCALE;
        v.sword.setVisible(true);
        v.sword.setAlpha(bladeAlpha);
        v.sword.setPosition(0, -2);
        v.sword.setRotation(Math.atan2(tipY, tipX));
        v.sword.setDisplaySize(Math.hypot(tipX, tipY), 5);
      }

      v.pips.forEach((pip, i) => pip.setFillStyle(i < p.health ? 0xff5570 : 0x3a3a44));
    }
  }

  /** Death juice: a quick recoil pop, then a spin-up while phasing out. */
  private playDeath(v: PlayerView): void {
    const startY = v.container.y;
    this.tweens.add({
      targets: v.container,
      y: startY - 18,
      scale: 1.15,
      duration: 130,
      ease: "Quad.easeOut",
      onComplete: () => {
        this.tweens.add({
          targets: v.container,
          y: startY - 60,
          angle: 180,
          alpha: 0,
          scale: 0.4,
          duration: 430,
          ease: "Cubic.easeIn",
          onComplete: () => v.container.setVisible(false),
        });
      },
    });
  }

  private emitHud(world: World, countdown: number): void {
    const local = world.players[this.cfg.driver.localId];
    this.cfg.onHud({
      countdown,
      health: local?.health ?? 0,
      dashFraction: local ? dashCooldownFraction(local.dash) : 1,
      attackFraction: local ? attackCooldownFraction(local.attackCooldownRemaining) : 1,
      alive: local?.status === "alive",
    });
  }

  // ---- setup ------------------------------------------------------------------

  private makeTextures(): void {
    const g = this.add.graphics();
    const d = VIS_R * 2;
    // One white body texture per shape (tinted per player at makeView). Each fills the same
    // d×d bounds so the face/sword/pips line up regardless of shape.
    for (const shape of SHAPES) {
      g.clear();
      g.fillStyle(0xffffff, 1);
      switch (shape) {
        case "circle":
          g.fillCircle(VIS_R, VIS_R, VIS_R);
          break;
        case "square":
          g.fillRoundedRect(1, 1, d - 2, d - 2, 4);
          break;
        case "triangle":
          g.fillTriangle(VIS_R, 0, d, d, 0, d);
          break;
        case "diamond":
          g.fillPoints([
            new Phaser.Math.Vector2(VIS_R, 0),
            new Phaser.Math.Vector2(d, VIS_R),
            new Phaser.Math.Vector2(VIS_R, d),
            new Phaser.Math.Vector2(0, VIS_R),
          ], true);
          break;
      }
      g.generateTexture(bodyTexture(shape), d, d);
    }
    g.clear();
    g.fillStyle(0x1f2430, 1);
    g.fillCircle(VIS_R - 5, VIS_R, 2.6);
    g.fillCircle(VIS_R + 5, VIS_R, 2.6);
    g.generateTexture("musa-face", d, d);
    g.destroy();
  }

  private makeView(id: PlayerId): PlayerView {
    const meta = this.cfg.driver.getMeta(id);
    const color = PALETTE[(meta.colorIndex ?? 0) % PALETTE.length]!;
    const shadow = this.add.ellipse(0, VIS_R - 1, VIS_R * 2.1, VIS_R * 0.8, 0x000000, 0.28);
    const body = this.add.image(0, 0, bodyTexture(meta.shape)).setTint(color);
    const face = this.add.image(0, -4, "musa-face");
    // Sword pivots at the player center and is SWORD_REACH_M long (tip == hit range);
    // it sweeps the 90° cone during a swing.
    const sword = this.add
      .rectangle(0, 0, SWORD_REACH_M * PX_PER_M, 5, 0xf8fafc)
      .setOrigin(0, 0.5)
      .setVisible(false);
    const name = this.add
      .text(0, -VIS_R - 16, meta.name, { fontFamily: "monospace", fontSize: "10px", color: "#e5e7eb" })
      .setOrigin(0.5, 1);
    const pips = [0, 1, 2].map((i) =>
      this.add.rectangle(-8 + i * 8, -VIS_R - 6, 6, 4, 0xff5570).setOrigin(0.5),
    );
    const container = this.add.container(0, 0, [shadow, sword, body, face, name, ...pips]);
    return { container, body, face, sword, pips, deadAnimated: false };
  }

  private drawField(): void {
    const g = this.add.graphics().setDepth(-1000);
    const h = FIELD_PX * Y_SCALE;
    g.fillStyle(0x14532d, 1).fillRect(MARGIN_X, OFFSET_Y, FIELD_PX, h);
    g.lineStyle(1, 0x166534, 0.6);
    for (let m = 0; m <= FIELD_M; m++) {
      g.lineBetween(sx(m), OFFSET_Y, sx(m), OFFSET_Y + h);
      g.lineBetween(MARGIN_X, sy(m), MARGIN_X + FIELD_PX, sy(m));
    }
    g.lineStyle(2, 0x22c55e, 0.9).strokeRect(MARGIN_X, OFFSET_Y, FIELD_PX, h);
  }
}
