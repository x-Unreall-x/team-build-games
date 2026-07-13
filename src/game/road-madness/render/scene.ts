/** Phaser presentation for the first Road Madness demolition-derby slice. */

import Phaser from "phaser";
import { ROAD_ARENA_HEIGHT_M, ROAD_ARENA_WIDTH_M } from "../constants";
import type { CarState, PlayerId, RoadEvent, RoadWorld, VehicleClass } from "../types";
import { VEHICLES } from "../vehicles";
import { createRoadKeyboard, type RoadKeyboardReader } from "./keyboard";
import type { RoadHudState, RoadSceneConfig } from "./contract";

export type {
  RoadDriver,
  RoadHudState,
  RoadPlayerMeta,
  RoadRenderEvent,
  RoadSceneConfig,
} from "./contract";

const PX_PER_M = 28;
const Y_SCALE = 0.72;
const MARGIN_X = 60;
const OFFSET_Y = 90;
const BOTTOM_PAD = 106;
const FIELD_W = ROAD_ARENA_WIDTH_M * PX_PER_M;
const FIELD_H = ROAD_ARENA_HEIGHT_M * PX_PER_M * Y_SCALE;

export const ROAD_WIDTH = MARGIN_X * 2 + FIELD_W;
export const ROAD_HEIGHT = OFFSET_Y + FIELD_H + BOTTOM_PAD;

const COLORS = [0x22d3ee, 0xf43f5e, 0xfbbf24, 0xa3e635, 0xc084fc, 0xfb923c, 0x2dd4bf, 0xf8fafc];
const vehicleTexture = (vehicle: VehicleClass, colorIndex: number) =>
  `road-car-${vehicle}-${colorIndex % COLORS.length}`;
const FIELD_TEXTURE = "road-madness-pit";
const TERRAIN_TEXTURE = "road-madness-pit-terrain";

const sx = (x: number): number => MARGIN_X + x * PX_PER_M;
const sy = (y: number): number => OFFSET_Y + y * PX_PER_M * Y_SCALE;
const screenAngle = (heading: number): number =>
  Math.atan2(Math.sin(heading) * Y_SCALE, Math.cos(heading));

interface CarView {
  shadow: Phaser.GameObjects.Ellipse;
  body: Phaser.GameObjects.Image;
  smoke: Phaser.GameObjects.Ellipse;
  fire: Phaser.GameObjects.Ellipse;
  boostGlow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  healthBack: Phaser.GameObjects.Rectangle;
  healthFill: Phaser.GameObjects.Rectangle;
}

export class RoadMadnessScene extends Phaser.Scene {
  private cfg!: RoadSceneConfig;
  private keyboard!: RoadKeyboardReader;
  private views: Record<PlayerId, CarView> = {};
  private lastProcessedTick = -1;
  private ended = false;
  private safeBorder!: Phaser.GameObjects.Rectangle;
  private suddenLabel!: Phaser.GameObjects.Text;
  private readonly trailMarks = new Set<Phaser.GameObjects.Graphics>();
  private readonly lastTrailTick: Record<PlayerId, number> = {};

  constructor() {
    super("road-madness");
  }

  preload(): void {
    this.load.image(
      TERRAIN_TEXTURE,
      "/assets/road-madness/terrain/derby-pit-v1.webp",
    );
  }

  create(): void {
    this.cfg = this.registry.get("cfg") as RoadSceneConfig;
    this.keyboard = createRoadKeyboard(this);
    this.makeTextures();
    this.drawPit();
  }

  override update(_time: number, deltaMs: number): void {
    const { world, countdown, roundBreak } = this.cfg.driver.frame(
      Math.min(deltaMs / 1000, 0.1),
      this.keyboard.read(),
    );
    this.processEvents(world);
    this.renderSafeBounds(world);
    this.renderCars(world);
    this.renderTrails(world);
    this.emitHud(world, countdown, roundBreak);
    if (world.phase === "ended" && !this.ended) {
      this.ended = true;
      this.cfg.onEnd(world);
    }
  }

  private makeTextures(): void {
    this.makeFieldTexture();
    for (const vehicle of Object.keys(VEHICLES) as VehicleClass[]) {
      for (let color = 0; color < COLORS.length; color += 1) {
        this.makeCarTexture(vehicle, color);
      }
    }
  }

  private makeFieldTexture(): void {
    const width = Math.ceil(FIELD_W);
    const height = Math.ceil(FIELD_H);
    const g = this.add.graphics();
    g.fillStyle(0x28252b, 1);
    g.fillRect(0, 0, width, height);
    g.lineStyle(1, 0x3f3b43, 0.58);
    const cellX = PX_PER_M * 2;
    const cellY = PX_PER_M * 2 * Y_SCALE;
    for (let x = 0; x <= width; x += cellX) g.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += cellY) g.lineBetween(0, y, width, y);
    // Scuffed concentric pit markings make motion easier to read.
    g.lineStyle(3, 0xf59e0b, 0.16);
    g.strokeEllipse(width / 2, height / 2, width * 0.62, height * 0.58);
    g.lineStyle(2, 0xf8fafc, 0.1);
    g.strokeEllipse(width / 2, height / 2, width * 0.28, height * 0.32);
    g.generateTexture(FIELD_TEXTURE, width, height);
    g.destroy();
  }

  private makeCarTexture(vehicle: VehicleClass, colorIndex: number): void {
    const monster = vehicle === "monster";
    const width = 64;
    const height = 42;
    const bodyW = monster ? 45 : 50;
    const bodyH = monster ? 29 : 23;
    const x = (width - bodyW) / 2;
    const y = (height - bodyH) / 2;
    const g = this.add.graphics();

    // Wheels sit outside the shell, with larger tires on the monster truck.
    const wheelW = monster ? 13 : 10;
    const wheelH = monster ? 7 : 5;
    g.fillStyle(0x09090b, 1);
    g.fillRoundedRect(x + 5, y - wheelH / 2, wheelW, wheelH, 2);
    g.fillRoundedRect(x + bodyW - wheelW - 5, y - wheelH / 2, wheelW, wheelH, 2);
    g.fillRoundedRect(x + 5, y + bodyH - wheelH / 2, wheelW, wheelH, 2);
    g.fillRoundedRect(x + bodyW - wheelW - 5, y + bodyH - wheelH / 2, wheelW, wheelH, 2);

    g.fillStyle(COLORS[colorIndex]!, 1);
    g.fillRoundedRect(x, y, bodyW, bodyH, monster ? 7 : 5);
    g.lineStyle(monster ? 3 : 2, 0xf8fafc, 0.7);
    g.lineBetween(x + bodyW - 1, y + 3, x + bodyW - 1, y + bodyH - 3); // front bumper
    g.lineStyle(2, 0x71717a, 0.85);
    g.lineBetween(x + 1, y + 4, x + 1, y + bodyH - 4); // rear bumper

    g.fillStyle(monster ? 0x172554 : 0x1e293b, 0.92);
    g.fillRoundedRect(x + bodyW * 0.35, y + 4, bodyW * 0.28, bodyH - 8, 3);
    g.fillStyle(0xf8fafc, 0.62);
    g.fillTriangle(x + bodyW - 8, y + bodyH / 2, x + bodyW - 14, y + 5, x + bodyW - 14, y + bodyH - 5);
    if (vehicle === "derby") {
      g.lineStyle(3, 0x18181b, 0.55);
      g.lineBetween(x + 8, y + bodyH - 4, x + bodyW - 8, y + 4);
    }
    g.generateTexture(vehicleTexture(vehicle, colorIndex), width, height);
    g.destroy();
  }

  private drawPit(): void {
    const terrainTexture = this.textures.exists(TERRAIN_TEXTURE)
      ? TERRAIN_TEXTURE
      : FIELD_TEXTURE;
    this.add
      .image(MARGIN_X + FIELD_W / 2, OFFSET_Y + FIELD_H / 2, terrainTexture)
      .setDisplaySize(FIELD_W, FIELD_H)
      .setDepth(-1000);
    const border = this.add
      .rectangle(MARGIN_X + FIELD_W / 2, OFFSET_Y + FIELD_H / 2, FIELD_W, FIELD_H)
      .setStrokeStyle(7, 0xf59e0b, 0.72)
      .setDepth(-990);
    border.setFillStyle(0x000000, 0);
    this.safeBorder = this.add
      .rectangle(MARGIN_X + FIELD_W / 2, OFFSET_Y + FIELD_H / 2, FIELD_W, FIELD_H)
      .setStrokeStyle(5, 0xef4444, 0.9)
      .setFillStyle(0x000000, 0)
      .setDepth(500)
      .setVisible(false);

    const title = this.add
      .text(ROAD_WIDTH / 2, 30, "THE PIT · LAST MADMAN STANDING", {
        fontFamily: "monospace",
        fontSize: "15px",
        color: "#fbbf24",
        fontStyle: "bold",
        letterSpacing: 2,
      })
      .setOrigin(0.5)
      .setDepth(-900)
      .setResolution(2);
    title.setAlpha(0.9);
    this.suddenLabel = this.add
      .text(ROAD_WIDTH / 2, 53, "SUDDEN DEATH · WALLS CLOSING", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#fca5a5",
        fontStyle: "bold",
        letterSpacing: 1,
      })
      .setOrigin(0.5)
      .setDepth(510)
      .setResolution(2)
      .setVisible(false);
  }

  private renderSafeBounds(world: RoadWorld): void {
    const bounds = world.safeBounds;
    this.safeBorder
      .setPosition((sx(bounds.minX) + sx(bounds.maxX)) / 2, (sy(bounds.minY) + sy(bounds.maxY)) / 2)
      .setDisplaySize(
        (bounds.maxX - bounds.minX) * PX_PER_M,
        (bounds.maxY - bounds.minY) * PX_PER_M * Y_SCALE,
      )
      .setAlpha(0.68 + Math.sin(world.tick * 0.22) * 0.22)
      .setVisible(world.suddenDeath);
    this.suddenLabel
      .setText(`SUDDEN DEATH · IMPACTS ×${world.damageMultiplier.toFixed(1)}`)
      .setVisible(world.suddenDeath);
  }

  private makeCarView(car: CarState): CarView {
    const meta = this.cfg.driver.getMeta(car.id);
    const shadow = this.add.ellipse(0, 0, car.vehicle === "monster" ? 54 : 48, 19, 0x000000, 0.35);
    const smoke = this.add.ellipse(0, 0, 20, 13, 0xa1a1aa, 0.42).setVisible(false);
    const fire = this.add.ellipse(0, 0, 15, 8, 0xfb923c, 0.82).setVisible(false);
    const boostGlow = this.add.ellipse(0, 0, 26, 10, 0x22d3ee, 0.66).setVisible(false);
    const body = this.add.image(0, 0, vehicleTexture(car.vehicle, meta.colorIndex));
    const label = this.add
      .text(0, 0, `${meta.name} · ${car.id === this.cfg.driver.localId ? "#1" : `#${meta.colorIndex + 1}`}`, {
        fontFamily: "monospace",
        fontSize: "9px",
        color: "#f8fafc",
        stroke: "#09090b",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setResolution(2);
    const healthBack = this.add.rectangle(0, 0, 44, 5, 0x09090b, 0.9).setOrigin(0, 0.5);
    const healthFill = this.add.rectangle(0, 0, 42, 3, 0x22c55e, 1).setOrigin(0, 0.5);
    return { shadow, body, smoke, fire, boostGlow, label, healthBack, healthFill };
  }

  private renderCars(world: RoadWorld): void {
    for (const id of Object.keys(world.cars).sort()) {
      const car = world.cars[id]!;
      if (car.status === "removed") {
        const removed = this.views[id];
        if (removed) {
          this.destroyCarView(removed);
          delete this.views[id];
        }
        continue;
      }
      const view = this.views[id] ?? (this.views[id] = this.makeCarView(car));
      const x = sx(car.pos.x);
      const y = sy(car.pos.y);
      const depth = car.pos.y;
      const angle = screenAngle(car.heading);
      const rearX = x - Math.cos(angle) * 24;
      const rearY = y - Math.sin(angle) * 24;
      view.shadow.setPosition(x + 2, y + 8).setDepth(depth - 0.02).setRotation(angle);
      view.boostGlow
        .setPosition(rearX, rearY)
        .setDepth(depth - 0.01)
        .setRotation(angle)
        .setScale(0.85 + Math.sin(world.tick * 0.7 + car.colorIndex) * 0.16, 1)
        .setVisible(car.boosting);
      view.body.setPosition(x, y).setDepth(depth).setRotation(angle);
      const healthFraction = Math.max(0, Math.min(1, car.health / car.maxHealth));
      const smokeVisible = healthFraction <= 0.5 || car.status === "wrecked";
      const fireVisible = healthFraction <= 0.25 || car.status === "wrecked";
      view.smoke
        .setPosition(rearX - Math.cos(angle) * 5, rearY - 10)
        .setDepth(depth + 0.01)
        .setScale(0.82 + Math.sin(world.tick * 0.17 + car.colorIndex) * 0.16)
        .setAlpha(0.28 + (1 - healthFraction) * 0.34)
        .setVisible(smokeVisible);
      view.fire
        .setPosition(rearX, rearY)
        .setDepth(depth + 0.015)
        .setRotation(angle)
        .setScale(0.72 + Math.sin(world.tick * 0.51 + car.colorIndex) * 0.18, 1)
        .setVisible(fireVisible);
      view.label.setPosition(x, y - 31).setDepth(depth + 0.02);
      view.healthBack.setPosition(x - 22, y + 28).setDepth(depth + 0.02);
      view.healthFill.setPosition(x - 21, y + 28).setDepth(depth + 0.03);
      view.healthFill.setScale(healthFraction, 1);
      view.healthFill.setFillStyle(
        healthFraction > 0.55 ? 0x22c55e : healthFraction > 0.25 ? 0xf59e0b : 0xef4444,
        1,
      );
      if (car.status === "wrecked") {
        view.body.setTint(0x52525b).setAlpha(0.74);
        view.label.setText(`${this.cfg.driver.getMeta(id).name} · WRECKED`).setColor("#a1a1aa");
        view.healthBack.setVisible(false);
        view.healthFill.setVisible(false);
      } else {
        view.body.setAlpha(1).clearTint();
        if (healthFraction <= 0.25) view.body.setTint(0xb45309);
        else if (healthFraction <= 0.5) view.body.setTint(0xa1a1aa);
        else if (healthFraction <= 0.75) view.body.setTint(0xd6d3d1);
        const meta = this.cfg.driver.getMeta(id);
        view.label
          .setText(`${meta.name} · ${id === this.cfg.driver.localId ? "#1" : `#${meta.colorIndex + 1}`}`)
          .setColor("#f8fafc");
        view.healthBack.setVisible(true);
        view.healthFill.setVisible(true);
      }
    }
  }

  private destroyCarView(view: CarView): void {
    view.shadow.destroy();
    view.body.destroy();
    view.smoke.destroy();
    view.fire.destroy();
    view.boostGlow.destroy();
    view.label.destroy();
    view.healthBack.destroy();
    view.healthFill.destroy();
  }

  private renderTrails(world: RoadWorld): void {
    for (const car of Object.values(world.cars)) {
      if (car.status !== "alive") continue;
      const speed = Math.hypot(car.vel.x, car.vel.y);
      const right = { x: -Math.sin(car.heading), y: Math.cos(car.heading) };
      const lateralSpeed = Math.abs(car.vel.x * right.x + car.vel.y * right.y);
      if (!car.boosting && (speed < 4 || lateralSpeed < 1.05)) continue;
      if (world.tick - (this.lastTrailTick[car.id] ?? -99) < 3) continue;
      this.lastTrailTick[car.id] = world.tick;

      const forward = { x: Math.cos(car.heading), y: Math.sin(car.heading) };
      const rear = {
        x: car.pos.x - forward.x * 0.58,
        y: car.pos.y - forward.y * 0.58,
      };
      const mark = this.add.graphics().setDepth(car.pos.y - 0.03);
      mark.lineStyle(car.boosting ? 3 : 2, car.boosting ? 0x22d3ee : 0x09090b, car.boosting ? 0.6 : 0.48);
      for (const side of [-1, 1]) {
        const start = { x: rear.x + right.x * 0.34 * side, y: rear.y + right.y * 0.34 * side };
        const end = { x: start.x - forward.x * 0.46, y: start.y - forward.y * 0.46 };
        mark.lineBetween(sx(start.x), sy(start.y), sx(end.x), sy(end.y));
      }
      this.trailMarks.add(mark);
      while (this.trailMarks.size > 240) {
        const oldest = this.trailMarks.values().next().value as Phaser.GameObjects.Graphics | undefined;
        if (!oldest) break;
        this.trailMarks.delete(oldest);
        oldest.destroy();
      }
      this.tweens.add({
        targets: mark,
        alpha: 0,
        duration: car.boosting ? 850 : 4200,
        onComplete: () => {
          this.trailMarks.delete(mark);
          mark.destroy();
        },
      });
    }
  }

  private processEvents(world: RoadWorld): void {
    let newest = this.lastProcessedTick;
    for (const event of world.events) {
      if (event.tick <= this.lastProcessedTick) continue;
      newest = Math.max(newest, event.tick);
      this.renderEvent(event);
    }
    this.lastProcessedTick = newest;
  }

  private renderEvent(event: RoadEvent): void {
    const localId = this.cfg.driver.localId;
    if (event.kind === "impact") {
      this.cfg.onEvent({
        type: "impact",
        local: event.sourceId === localId || event.targetId === localId,
        damage: event.damage,
      });
      const x = sx(event.point.x);
      const y = sy(event.point.y);
      const g = this.add.graphics().setDepth(event.point.y + 10);
      g.lineStyle(2, 0xfef08a, 1);
      const rays = 7;
      for (let i = 0; i < rays; i += 1) {
        const angle = (i / rays) * Math.PI * 2 + event.tick * 0.37;
        const inner = 4;
        const outer = 10 + Math.min(10, event.damage * 0.25);
        g.lineBetween(
          x + Math.cos(angle) * inner,
          y + Math.sin(angle) * inner,
          x + Math.cos(angle) * outer,
          y + Math.sin(angle) * outer,
        );
      }
      this.tweens.add({ targets: g, alpha: 0, scale: 1.45, duration: 170, onComplete: () => g.destroy() });
      if (event.sourceId === localId || event.targetId === localId) {
        this.cameras.main.shake(85, Math.min(0.007, 0.0015 + event.damage * 0.00014));
      }
    } else if (event.kind === "wrecked") {
      this.cfg.onEvent({ type: "wrecked", local: event.carId === localId });
      const ring = this.add.circle(sx(event.point.x), sy(event.point.y), 12, 0xf97316, 0.55).setDepth(event.point.y + 9);
      this.tweens.add({
        targets: ring,
        alpha: 0,
        scale: 3.2,
        duration: 340,
        onComplete: () => ring.destroy(),
      });
    } else {
      this.cfg.onEvent({ type: "nitro", local: event.carId === localId });
      const burst = this.add
        .ellipse(sx(event.point.x), sy(event.point.y), 18, 8, 0x22d3ee, 0.72)
        .setDepth(event.point.y + 8);
      this.tweens.add({
        targets: burst,
        alpha: 0,
        scaleX: 2.5,
        scaleY: 1.7,
        duration: 230,
        onComplete: () => burst.destroy(),
      });
    }
  }

  private emitHud(world: RoadWorld, countdown: number, roundBreak: number): void {
    const local = world.cars[this.cfg.driver.localId];
    if (!local) return;
    const hud: RoadHudState = {
      countdown,
      health: local.health,
      maxHealth: local.maxHealth,
      speed: Math.hypot(local.vel.x, local.vel.y),
      status: local.status,
      alive: Object.values(world.cars).filter((car) => car.status === "alive").length,
      total: Object.keys(world.cars).length,
      damageDealt: local.damageDealt,
      elapsed: world.elapsed,
      matchElapsed: world.matchElapsed,
      nitro: local.nitro,
      boosting: local.boosting,
      phase: world.phase,
      roundNumber: world.roundNumber,
      bestOf: world.rules.bestOf,
      roundWins: world.roundWins,
      roundWinnerId: world.roundWinnerId,
      roundEndReason: world.roundEndReason,
      roundBreak,
      suddenDeath: world.suddenDeath,
      damageMultiplier: world.damageMultiplier,
    };
    this.cfg.onHud(hud);
  }
}
