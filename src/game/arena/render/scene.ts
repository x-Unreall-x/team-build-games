import Phaser from "phaser";
import {
  ATTACK_TTL_S,
  FIELD_M,
  FIGURE_RADIUS_M,
  PX_PER_M,
} from "../../constants";
import { WEAPONS, WEAPON_LIST, type Weapon } from "../weapons";
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
const weaponTexture = (weapon: Weapon) => `weapon-${weapon}`;
/** Canonical weapon-sprite texture size (drawn pointing +x; stretched to reach at render). */
const WEP_W = 64;
const WEP_H = 16;

// ---- 2.5D render constants (the sim stays flat top-down in meters) -----------
// Margins/paddings scale with the same +40% as PX_PER_M so the whole canvas grows uniformly.
const MARGIN_X = 56;
const OFFSET_Y = 109;
const BOTTOM_PAD = 98;
const Y_SCALE = 0.62;
const VIS_R = FIGURE_RADIUS_M * PX_PER_M; // drawn body == physical body
const FIELD_PX = FIELD_M * PX_PER_M;

export const ARENA_WIDTH = MARGIN_X * 2 + FIELD_PX;
export const ARENA_HEIGHT = OFFSET_Y + FIELD_PX * Y_SCALE + BOTTOM_PAD;

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
  /** Weapon sprite (detailed per-weapon texture), drawn above the body so it's always visible. */
  sword: Phaser.GameObjects.Image;
  pips: Phaser.GameObjects.Rectangle[];
  /** Signed-in member's circular photo, layered over the body once loaded (else the shape shows). */
  avatar?: Phaser.GameObjects.Image;
  deadAnimated: boolean;
}

const sx = (xm: number) => MARGIN_X + xm * PX_PER_M;
const sy = (ym: number) => OFFSET_Y + ym * PX_PER_M * Y_SCALE;

export class ArenaScene extends Phaser.Scene {
  private cfg!: ArenaConfig;
  private keyboard!: KeyboardReader;
  private views: Record<PlayerId, PlayerView> = {};
  private projViews: Record<string, Phaser.GameObjects.Image> = {};
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
        this.cfg.onEvent(WEAPONS[p.weapon].ranged ? { type: "shoot" } : { type: "attack" });
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
      const atk = p.attack;
      const ready = p.attackCooldownRemaining <= 0;
      if (!atk && !ready) {
        v.sword.setVisible(false);
      } else {
        const aim = atk ? atk.aim : p.aim;
        const alpha = atk ? 1 : 0.5;
        // swing progress 0→1 over the swing's lifetime
        const progress = atk ? Math.max(0, Math.min(1, 1 - atk.ttl / ATTACK_TTL_S)) : 0;
        v.sword.setVisible(true);
        v.sword.setAlpha(alpha);
        v.sword.setTexture(weaponTexture(p.weapon));
        if (stats.ranged) {
          // Bow: a fixed-length held sprite pointing along the aim (arrows fly as separate sprites).
          const L = 1.1; // meters — drawn bow length (reach is 0; damage is carried by the arrow)
          const tipX = Math.cos(aim) * L * PX_PER_M;
          const tipY = Math.sin(aim) * L * PX_PER_M * Y_SCALE;
          v.sword.setPosition(0, -2);
          v.sword.setRotation(Math.atan2(tipY, tipX));
          v.sword.setDisplaySize(Math.hypot(tipX, tipY), WEP_H);
        } else if (stats.thrust) {
          // Spear held mid-shaft: at rest 40% of its length sits BEHIND the player; a strike
          // jabs it forward (out-and-back) so the tip reaches full reach at the peak.
          const jab = Math.sin(progress * Math.PI); // 0 → 1 → 0
          const shift = jab * 0.4 * stats.reach;
          const backM = -0.4 * stats.reach + shift; // tail (behind the player at rest)
          const frontM = 0.6 * stats.reach + shift; // tip
          const c = Math.cos(aim);
          const s = Math.sin(aim);
          const baseX = c * backM * PX_PER_M;
          const baseY = s * backM * PX_PER_M * Y_SCALE;
          const tipX = c * frontM * PX_PER_M;
          const tipY = s * frontM * PX_PER_M * Y_SCALE;
          v.sword.setPosition(baseX, baseY - 2);
          v.sword.setRotation(Math.atan2(tipY - baseY, tipX - baseX));
          v.sword.setDisplaySize(Math.hypot(tipX - baseX, tipY - baseY), WEP_H);
        } else {
          // Sword/knife: sweep the cone from the player center (rest pose points along the aim).
          const half = stats.coneHalfAngle;
          const ang = atk ? aim - half + progress * 2 * half : aim;
          // Project onto the foreshortened ground plane (y * Y_SCALE) so on-screen reach matches.
          const tipX = Math.cos(ang) * stats.reach * PX_PER_M;
          const tipY = Math.sin(ang) * stats.reach * PX_PER_M * Y_SCALE;
          v.sword.setPosition(0, -2);
          v.sword.setRotation(Math.atan2(tipY, tipX));
          v.sword.setDisplaySize(Math.hypot(tipX, tipY), WEP_H);
        }
      }

      v.pips.forEach((pip, i) => pip.setFillStyle(i < p.health ? 0xff5570 : 0x3a3a44));
    }

    this.renderProjectiles(world);
  }

  /** In-flight arrows: one pooled sprite per projectile id, oriented along its (Y-projected) heading. */
  private renderProjectiles(world: World): void {
    const live = new Set<string>();
    for (const proj of world.projectiles) {
      live.add(proj.id);
      let img = this.projViews[proj.id];
      if (!img) {
        img = this.add.image(0, 0, "arrow").setOrigin(0.5, 0.5);
        img.setDisplaySize(0.9 * PX_PER_M, 0.3 * PX_PER_M);
        this.projViews[proj.id] = img;
      }
      img.setPosition(sx(proj.pos.x), sy(proj.pos.y));
      img.setDepth(proj.pos.y);
      img.setRotation(Math.atan2(proj.vel.y * Y_SCALE, proj.vel.x));
    }
    for (const id of Object.keys(this.projViews)) {
      if (!live.has(id)) {
        this.projViews[id]!.destroy();
        delete this.projViews[id];
      }
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

    for (const w of WEAPON_LIST) {
      g.clear();
      this.drawWeapon(g, w);
      g.generateTexture(weaponTexture(w), WEP_W, WEP_H);
    }

    // In-flight arrow (points +x): shaft + fletching + steel head.
    g.clear();
    g.fillStyle(0x6b4a2f, 1).fillRect(2, 3.1, 15, 1.8); // shaft
    g.fillStyle(0xf3f4f6, 1).fillTriangle(2, 2, 6, 4, 2, 6); // fletching
    g.fillStyle(0xd7dbe0, 1).fillTriangle(16, 1.5, 24, 4, 16, 6.5); // head
    g.generateTexture("arrow", 24, 8);
    g.destroy();
  }

  /** Draw a weapon pointing +x into `g` (handle/butt at the left, tip at the right). */
  private drawWeapon(g: Phaser.GameObjects.Graphics, weapon: Weapon): void {
    const SILVER = 0xd7dbe0, SHEEN = 0xeef2f6, GOLD = 0xf6c453, WOOD = 0x8a5a2b, GRIP = 0x3f3a44, STEEL = 0x9ca3af;
    switch (weapon) {
      case "sword":
        g.fillStyle(STEEL, 1).fillCircle(4, 8, 2.5); // pommel
        g.fillStyle(GRIP, 1).fillRect(5, 6, 12, 4); // handle
        g.fillStyle(GOLD, 1).fillRect(16, 1, 4, 14); // crossguard
        g.fillStyle(SILVER, 1).fillRect(20, 6, 40, 4); // blade
        g.fillStyle(SHEEN, 1).fillRect(20, 6, 38, 1.5); // edge highlight
        g.fillStyle(SILVER, 1).fillTriangle(60, 6, 64, 8, 60, 10); // point
        break;
      case "spear":
        g.fillStyle(WOOD, 1).fillRect(2, 6.8, 44, 2.4); // shaft
        g.fillStyle(GRIP, 1).fillRect(42, 6, 5, 4); // binding at the head
        g.fillStyle(SILVER, 1).fillTriangle(46, 2.5, 64, 8, 46, 13.5); // leaf head
        g.fillStyle(SHEEN, 1).fillTriangle(50, 6.5, 62, 8, 50, 9.5); // head sheen
        break;
      case "knife":
        g.fillStyle(GRIP, 1).fillRect(6, 6, 14, 4); // handle
        g.fillStyle(STEEL, 1).fillRect(19, 5, 2, 6); // guard
        g.fillStyle(SILVER, 1).fillRect(21, 6.5, 29, 3); // blade
        g.fillStyle(SILVER, 1).fillTriangle(50, 6.5, 58, 8, 50, 9.5); // point
        g.fillStyle(SHEEN, 1).fillRect(21, 6.5, 27, 1); // edge highlight
        break;
      case "bow": {
        // Simple recurved bow + nocked arrow (placeholder until the bow projectile slice).
        g.lineStyle(2, WOOD, 1);
        g.beginPath();
        g.arc(14, 8, 7, -1.1, 1.1);
        g.strokePath();
        g.lineStyle(1, STEEL, 0.9);
        g.beginPath();
        g.moveTo(14, 1.5);
        g.lineTo(14, 14.5);
        g.strokePath();
        g.fillStyle(WOOD, 1).fillRect(14, 7.4, 40, 1.2); // arrow shaft
        g.fillStyle(SILVER, 1).fillTriangle(54, 6.5, 60, 8, 54, 9.5); // arrowhead
        break;
      }
    }
  }

  private makeView(id: PlayerId): PlayerView {
    const meta = this.cfg.driver.getMeta(id);
    const color = PALETTE[(meta.colorIndex ?? 0) % PALETTE.length]!;
    const shadow = this.add.ellipse(0, VIS_R - 1, VIS_R * 2.1, VIS_R * 0.8, 0x000000, 0.28);
    const body = this.add.image(0, 0, bodyTexture(meta.shape)).setTint(color);
    const face = this.add.image(0, -4, "musa-face");
    // Weapon: a detailed sprite whose handle pivots at the player center; stretched to reach and
    // rotated to the aim each frame. Its texture is set per-weapon in render().
    const sword = this.add
      .image(0, 0, weaponTexture("sword"))
      .setOrigin(0, 0.5)
      .setVisible(false);
    const name = this.add
      .text(0, -VIS_R - 16, meta.name, { fontFamily: "monospace", fontSize: "10px", color: "#e5e7eb" })
      .setOrigin(0.5, 1);
    const pips = [0, 1, 2].map((i) =>
      this.add.rectangle(-8 + i * 8, -VIS_R - 6, 6, 4, 0xff5570).setOrigin(0.5),
    );
    // Draw order (back→front): shadow, body, face, WEAPON (above body so it's always visible),
    // then the name + health pips floating on top.
    const container = this.add.container(0, 0, [shadow, body, face, sword, name, ...pips]);
    const view: PlayerView = { container, body, face, sword, pips, deadAnimated: false };
    if (meta.avatarUrl) this.loadAvatar(id, meta.avatarUrl, view);
    return view;
  }

  /**
   * Load a signed-in member's photo and layer it as a circular avatar over the body. Fully
   * best-effort: on load error OR a CORS-tainted source (the getImageData guard throws before we'd
   * ever hand a tainted canvas to WebGL), we simply keep the shape/color body. Never blocks render.
   */
  private loadAvatar(id: PlayerId, url: string, view: PlayerView): void {
    const srcKey = `avatar-src-${id}`;
    const cirKey = `avatar-cir-${id}`;
    const d = VIS_R * 2;

    const apply = () => {
      try {
        if (!this.textures.exists(srcKey)) return;
        const src = this.textures.get(srcKey).getSourceImage() as CanvasImageSource;
        const canvas = document.createElement("canvas");
        canvas.width = d;
        canvas.height = d;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.save();
        ctx.beginPath();
        ctx.arc(d / 2, d / 2, d / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(src, 0, 0, d, d);
        ctx.restore();
        ctx.getImageData(0, 0, 1, 1); // taint guard: throws on a CORS-tainted source → keep the shape
        if (this.textures.exists(cirKey)) this.textures.remove(cirKey);
        this.textures.addCanvas(cirKey, canvas);
        const avatar = this.add.image(0, 0, cirKey);
        view.container.addAt(avatar, view.container.getIndex(view.face) + 1); // above face, below weapon
        view.avatar = avatar;
        view.body.setVisible(false);
        view.face.setVisible(false);
      } catch {
        /* CORS-tainted or draw error → the shape body stays. */
      }
    };

    if (this.textures.exists(srcKey)) {
      apply();
      return;
    }
    this.load.crossOrigin = "anonymous"; // required so the CDN image yields a clean (untainted) canvas
    this.load.image({ key: srcKey, url });
    this.load.once(`filecomplete-image-${srcKey}`, apply);
    this.load.start();
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
