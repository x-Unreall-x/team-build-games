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
import type { Shape } from "../cosmetic";
import type { ArenaEvent, HudState, MatchDriver } from "./contract";

export type { ArenaEvent, HudState, PlayerMeta, MatchDriver } from "./contract";

const BODY_ASSET: Record<Shape, string> = {
  circle: "/assets/arena/warriors/swordsman.png",
  square: "/assets/arena/warriors/spearman.png",
  triangle: "/assets/arena/warriors/knife-fighter.png",
  diamond: "/assets/arena/warriors/archer.png",
};

const WEAPON_ASSET: Record<Weapon, string> = {
  sword: "/assets/arena/weapons/sword.png",
  spear: "/assets/arena/weapons/spear.png",
  knife: "/assets/arena/weapons/knife.png",
  bow: "/assets/arena/weapons/bow.png",
};

const bodyTexture = (shape: Shape) => `fighter-${shape}`;
const weaponTexture = (weapon: Weapon) => `weapon-${weapon}`;
const TERRAIN_TEXTURE = "arena-terrain";
const ARROW_TEXTURE = "arrow";

// ---- 2.5D render constants (the sim stays flat top-down in meters) -----------
// Margins/paddings scale with the same +40% as PX_PER_M so the whole canvas grows uniformly.
const MARGIN_X = 56;
const OFFSET_Y = 109;
const BOTTOM_PAD = 98;
const Y_SCALE = 0.62;
const VIS_R = FIGURE_RADIUS_M * PX_PER_M; // drawn body == physical body
const FIELD_PX = FIELD_M * PX_PER_M;
const BODY_HEIGHT = VIS_R * 3.2;
const AVATAR_TEXTURE_SIZE = 128;

const WEAPON_HEIGHT: Record<Weapon, number> = {
  sword: 15,
  spear: 12,
  knife: 9,
  bow: 14,
};

/** Head placement in container pixels for each fighter illustration. */
const AVATAR_PLACEMENT: Record<Shape, { x: number; y: number; size: number }> = {
  circle: { x: 7, y: -18, size: 20 },
  square: { x: 5, y: -21, size: 20 },
  triangle: { x: 4, y: -18, size: 19 },
  diamond: { x: -2, y: -22, size: 20 },
};

export const ARENA_WIDTH = MARGIN_X * 2 + FIELD_PX;
export const ARENA_HEIGHT = OFFSET_Y + FIELD_PX * Y_SCALE + BOTTOM_PAD;

export interface ArenaConfig {
  driver: MatchDriver;
  onHud: (h: HudState) => void;
  onEvent: (e: ArenaEvent) => void;
  onEnd: (winnerId: PlayerId | null) => void;
}

interface PlayerView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  shape: Shape;
  /** Weapon sprite (detailed per-weapon texture), drawn above the body so it's always visible. */
  sword: Phaser.GameObjects.Image;
  pips: Phaser.GameObjects.Rectangle[];
  /** Signed-in member's circular photo, layered over the illustrated fighter's head. */
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

  preload(): void {
    this.load.image(TERRAIN_TEXTURE, "/assets/arena/terrain.png");
    this.load.image(ARROW_TEXTURE, "/assets/arena/weapons/arrow.png");
    for (const [shape, url] of Object.entries(BODY_ASSET) as [Shape, string][]) {
      this.load.image(bodyTexture(shape), url);
    }
    for (const weapon of WEAPON_LIST) {
      this.load.image(weaponTexture(weapon), WEAPON_ASSET[weapon]);
    }
  }

  create(): void {
    this.cfg = this.registry.get("cfg") as ArenaConfig;
    this.keyboard = createKeyboard(this);
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
      const facingSign = fv.x < 0 ? -1 : 1;
      v.body.setFlipX(facingSign < 0);
      if (v.avatar) {
        const placement = AVATAR_PLACEMENT[v.shape];
        v.avatar.setPosition(placement.x * facingSign, placement.y);
      }

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
          v.sword.setDisplaySize(Math.hypot(tipX, tipY), WEAPON_HEIGHT[p.weapon]);
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
          v.sword.setDisplaySize(Math.hypot(tipX - baseX, tipY - baseY), WEAPON_HEIGHT[p.weapon]);
        } else {
          // Sword/knife: sweep the cone from the player center (rest pose points along the aim).
          const half = stats.coneHalfAngle;
          const ang = atk ? aim - half + progress * 2 * half : aim;
          // Project onto the foreshortened ground plane (y * Y_SCALE) so on-screen reach matches.
          const tipX = Math.cos(ang) * stats.reach * PX_PER_M;
          const tipY = Math.sin(ang) * stats.reach * PX_PER_M * Y_SCALE;
          v.sword.setPosition(0, -2);
          v.sword.setRotation(Math.atan2(tipY, tipX));
          v.sword.setDisplaySize(Math.hypot(tipX, tipY), WEAPON_HEIGHT[p.weapon]);
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
        img = this.add.image(0, 0, ARROW_TEXTURE).setOrigin(0.5, 0.5);
        img.setDisplaySize(0.9 * PX_PER_M, 0.14 * PX_PER_M);
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

  private makeView(id: PlayerId): PlayerView {
    const meta = this.cfg.driver.getMeta(id);
    const shadow = this.add.ellipse(0, VIS_R - 1, VIS_R * 2.1, VIS_R * 0.8, 0x000000, 0.28);
    const body = this.add.image(0, 0, bodyTexture(meta.shape));
    const scale = BODY_HEIGHT / body.height;
    body.setDisplaySize(body.width * scale, BODY_HEIGHT);
    // Weapon: a detailed sprite whose handle pivots at the player center; stretched to reach and
    // rotated to the aim each frame. Its texture is set per-weapon in render().
    const sword = this.add
      .image(0, 0, weaponTexture("sword"))
      .setOrigin(0, 0.5)
      .setVisible(false);
    const name = this.add
      .text(0, -BODY_HEIGHT / 2 - 14, meta.name, {
        fontFamily: "monospace",
        fontSize: "9px",
        color: "#f5f5f5",
        backgroundColor: "#111827",
        stroke: "#000000",
        strokeThickness: 1,
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setResolution(2);
    const pips = [0, 1, 2].map((i) =>
      this.add.rectangle(-8 + i * 8, -BODY_HEIGHT / 2 - 5, 6, 4, 0xff5570).setOrigin(0.5),
    );
    // Draw order (back→front): shadow, body, weapon, then floating HUD.
    // then the name + health pips floating on top.
    const container = this.add.container(0, 0, [shadow, body, sword, name, ...pips]);
    const view: PlayerView = {
      container,
      body,
      shape: meta.shape,
      sword,
      pips,
      deadAnimated: false,
    };
    if (meta.avatarUrl) this.loadAvatar(id, meta.avatarUrl, view);
    return view;
  }

  /**
   * Load a signed-in member's photo and layer it as a circular face over the fighter's head. Fully
   * best-effort: on load error OR a CORS-tainted source (the getImageData guard throws before we'd
   * ever hand a tainted canvas to WebGL), we simply keep the illustrated fighter. Never blocks render.
   */
  private loadAvatar(id: PlayerId, url: string, view: PlayerView): void {
    const srcKey = `avatar-src-${id}`;
    const cirKey = `avatar-cir-${id}`;
    const d = AVATAR_TEXTURE_SIZE;

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
        const inset = 5;
        ctx.beginPath();
        ctx.arc(d / 2, d / 2, d / 2 - inset, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(src, inset, inset, d - inset * 2, d - inset * 2);
        ctx.restore();
        ctx.strokeStyle = "#f5f5f5";
        ctx.lineWidth = inset * 2;
        ctx.beginPath();
        ctx.arc(d / 2, d / 2, d / 2 - inset, 0, Math.PI * 2);
        ctx.stroke();
        ctx.getImageData(0, 0, 1, 1); // taint guard: throws on a CORS-tainted source → keep the fighter
        if (this.textures.exists(cirKey)) this.textures.remove(cirKey);
        this.textures.addCanvas(cirKey, canvas);
        const placement = AVATAR_PLACEMENT[view.shape];
        const avatar = this.add
          .image(placement.x, placement.y, cirKey)
          .setDisplaySize(placement.size, placement.size);
        view.container.addAt(avatar, view.container.getIndex(view.sword));
        view.avatar = avatar;
      } catch {
        /* CORS-tainted or draw error → the illustrated fighter stays. */
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
    const h = FIELD_PX * Y_SCALE;
    this.add
      .image(MARGIN_X + FIELD_PX / 2, OFFSET_Y + h / 2, TERRAIN_TEXTURE)
      .setDisplaySize(FIELD_PX, h)
      .setDepth(-1001);
    this.add
      .rectangle(MARGIN_X + FIELD_PX / 2, OFFSET_Y + h / 2, FIELD_PX, h)
      .setStrokeStyle(2, 0xd6b36a, 0.75)
      .setDepth(-1000);
  }
}
