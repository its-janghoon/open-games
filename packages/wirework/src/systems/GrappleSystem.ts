import Phaser from 'phaser';
import { AudioKeys, type AudioKey } from '../config/AssetKeys';
import { GAS, GRAPPLE } from '../config/PlayerConfig';
import { isNodeHook, nodeFlingAccel, rayAabbIntersection, reelStep } from './SiegeGeometry';
import { AudioManager } from './AudioManager';
import type { Player } from '../entities/Player';
import type { GasSystem } from './GasSystem';

export interface GrappleSurface {
  readonly bounds: Phaser.Geom.Rectangle;
  readonly insertionOrder: number;
  readonly isValid: boolean;
}
export interface GrappleTarget {
  readonly x: number;
  readonly y: number;
  readonly bounds: Phaser.Geom.Rectangle;
  readonly isValid: boolean;
  readonly insertionOrder: number;
  readonly source?: unknown;
  readonly getNode?: () => { x: number; y: number };
}
export interface GrappleCandidate {
  readonly point: Phaser.Math.Vector2;
  readonly anchor: Phaser.Math.Vector2;
  readonly target: GrappleTarget | null;
  readonly surface: GrappleSurface | null;
  readonly nodeHooked: boolean;
}
export interface GrappleInput {
  fireHeld: boolean;
  aimX: number;
  aimY: number;
  reelIn: boolean;
  reelOut: boolean;
}
const enum WirePhase { Idle, Firing, Attached }
interface RayHit {
  readonly point: Phaser.Math.Vector2;
  readonly target: GrappleTarget | null;
  readonly surface: GrappleSurface | null;
}

/** Charge-backed tether with stable nearest-hit ordering and live anchors. */
export class GrappleSystem {
  private phase = WirePhase.Idle;
  private readonly anchor = new Phaser.Math.Vector2();
  private readonly hookPos = new Phaser.Math.Vector2();
  private ropeLength = 0;
  private surfaces: GrappleSurface[] = [];
  private targets: GrappleTarget[] = [];
  private attachedTarget: GrappleTarget | null = null;
  private attachedSurface: GrappleSurface | null = null;
  private nodeHooked = false;
  private readonly wire: Phaser.GameObjects.Graphics;
  /**
   * AIM PREVIEW.
   *
   * Drawn just under the wire whenever the tether is idle: a ring at the point
   * the hook WOULD anchor to for the current aim, plus a dashed line to it.
   *
   * This exists because the tether was effectively undiscoverable. It is
   * hold-to-use (see {@link update}), so a player who clicks sees the hook
   * cancel on the same frame and concludes the mechanic is broken - with no
   * feedback about where it was even aiming. The preview makes the mechanic
   * legible BEFORE committing: you can see what you would grab, and that
   * something is grabbable at all.
   *
   * It reuses {@link resolveCandidate}, so the preview and the real shot cannot
   * disagree - they run the identical raycast against the identical lists.
   */
  private readonly aimGfx: Phaser.GameObjects.Graphics;
  private readonly audio: AudioManager;
  private whooshAt = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly player: Player,
    private readonly gas: GasSystem,
  ) {
    this.audio = AudioManager.get(scene);
    this.wire = scene.add.graphics().setDepth(5);
    this.aimGfx = scene.add.graphics().setDepth(4);
  }

  setSurfaces(surfaces: GrappleSurface[]): void { this.surfaces = surfaces; }
  setTargets(targets: GrappleTarget[]): void { this.targets = targets; }
  get isAttached(): boolean { return this.phase === WirePhase.Attached; }
  get isActive(): boolean { return this.phase !== WirePhase.Idle; }
  get isNodeAttached(): boolean { return this.nodeHooked && this.phase === WirePhase.Attached; }

  fire(aimX: number, aimY: number, nowMs: number): boolean {
    const hit = this.resolveCandidate(this.player.x, this.player.y, aimX, aimY);
    if (!hit || !this.gas.spend(GAS.COST_GRAPPLE_FIRE, nowMs)) return false;
    this.clear(false);
    this.phase = WirePhase.Firing;
    this.attachedTarget = hit.target;
    this.attachedSurface = hit.surface;
    this.nodeHooked = hit.nodeHooked;
    this.anchor.copy(hit.anchor);
    this.hookPos.set(this.player.x, this.player.y);
    this.player.swinging = false;
    this.playSound(AudioKeys.TetherFire);
    return true;
  }

  resolveCandidate(originX: number, originY: number, aimX: number, aimY: number): GrappleCandidate | null {
    const hit = this.raycast(originX, originY, aimX, aimY);
    if (!hit) return null;
    const node = hit.target?.getNode?.();
    const nodeHooked = Boolean(node && isNodeHook(hit.point.x, hit.point.y, node.x, node.y, GRAPPLE.NODE_ANCHOR_SNAP_DIST));
    return {
      ...hit,
      nodeHooked,
      anchor: nodeHooked && node
        ? new Phaser.Math.Vector2(node.x, node.y)
        : hit.point.clone(),
    };
  }

  release(): void {
    if (this.phase === WirePhase.Idle) return;
    this.clear(this.phase === WirePhase.Attached);
  }

  /** Clear transient wire/input state without creating release momentum (pause, blur, disconnect). */
  cancel(): void {
    if (this.phase !== WirePhase.Idle) this.clear(false);
  }

  private clear(applyFling: boolean): void {
    if (applyFling) {
      const body = this.player.body;
      body.velocity.scale(GRAPPLE.RELEASE_VELOCITY_KEEP);
      const rx = this.player.x - this.anchor.x;
      const ry = this.player.y - this.anchor.y;
      const length = Math.hypot(rx, ry) || 1;
      body.velocity.x += (rx / length) * GRAPPLE.RELEASE_RADIAL_BOOST;
      body.velocity.y += (ry / length) * GRAPPLE.RELEASE_RADIAL_BOOST;
      this.player.beginReleaseFling();
    }
    this.phase = WirePhase.Idle;
    this.player.swinging = false;
    this.attachedTarget = null;
    this.attachedSurface = null;
    this.nodeHooked = false;
    this.wire.clear();
  }

  update(input: GrappleInput, dtMs: number, nowMs: number): void {
    const dt = dtMs / 1000;
    if (!this.trackLiveAnchor()) { this.render(); this.renderAimPreview(input); return; }
    if (!input.fireHeld && this.phase !== WirePhase.Idle) {
      this.release();
      this.render();
      this.renderAimPreview(input);
      return;
    }
    if (this.phase === WirePhase.Firing) this.advanceHook(dt);
    if (this.phase === WirePhase.Attached) this.applySwingPhysics(input, dt, dtMs, nowMs);
    this.render();
    this.renderAimPreview(input);
  }

  /**
   * Draw where the hook would land for the current aim. Idle only: once the wire
   * is out, the wire itself is the feedback and a second line would just be
   * noise. A node hook (much stronger pull, the intended way to kill a machine)
   * gets a bigger double ring so the two outcomes are distinguishable at a
   * glance, and an unaffordable shot is dimmed rather than hidden - "not enough
   * charge" is different information from "nothing to grab".
   */
  private renderAimPreview(input: GrappleInput): void {
    const g = this.aimGfx;
    g.clear();
    if (this.phase !== WirePhase.Idle) return;

    const candidate = this.resolveCandidate(this.player.x, this.player.y, input.aimX, input.aimY);
    if (!candidate) return;

    const affordable = this.gas.canAfford(GAS.COST_GRAPPLE_FIRE);
    const alpha = affordable ? 0.85 : 0.3;
    const colour = candidate.nodeHooked ? GRAPPLE.PREVIEW_NODE_COLOR : GRAPPLE.PREVIEW_COLOR;
    const { x, y } = candidate.anchor;

    // Dashed lead line: cheap to draw and reads as "potential" rather than the
    // solid wire, which means "attached".
    const dx = x - this.player.x;
    const dy = y - this.player.y;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      const ux = dx / length;
      const uy = dy / length;
      g.lineStyle(1, colour, alpha * 0.5);
      const dash = 8;
      for (let t = 0; t < length; t += dash * 2) {
        const end = Math.min(t + dash, length);
        g.lineBetween(
          this.player.x + ux * t, this.player.y + uy * t,
          this.player.x + ux * end, this.player.y + uy * end,
        );
      }
    }

    g.lineStyle(1, colour, alpha);
    g.strokeCircle(x, y, GRAPPLE.PREVIEW_RADIUS);
    if (candidate.nodeHooked) {
      g.strokeCircle(x, y, GRAPPLE.PREVIEW_RADIUS + 4);
    }
    // Crosshair ticks so the ring is findable against busy wall texture.
    const r = GRAPPLE.PREVIEW_RADIUS;
    g.lineBetween(x - r - 3, y, x - r + 1, y);
    g.lineBetween(x + r - 1, y, x + r + 3, y);
    g.lineBetween(x, y - r - 3, x, y - r + 1);
    g.lineBetween(x, y + r - 1, x, y + r + 3);
  }

  private trackLiveAnchor(): boolean {
    if (this.attachedSurface && !this.attachedSurface.isValid) {
      this.clear(this.phase === WirePhase.Attached);
      return false;
    }
    if (!this.attachedTarget) return true;
    if (!this.attachedTarget.isValid) {
      this.clear(this.phase === WirePhase.Attached);
      return false;
    }
    const node = this.nodeHooked ? this.attachedTarget.getNode?.() : null;
    this.anchor.set(node?.x ?? this.attachedTarget.x, node?.y ?? this.attachedTarget.y);
    if (
      this.phase === WirePhase.Attached &&
      Phaser.Math.Distance.Between(this.player.x, this.player.y, this.anchor.x, this.anchor.y) > GRAPPLE.MAX_LENGTH
    ) {
      this.clear(true);
      return false;
    }
    return true;
  }

  private advanceHook(dt: number): void {
    const dx = this.anchor.x - this.hookPos.x;
    const dy = this.anchor.y - this.hookPos.y;
    const distance = Math.hypot(dx, dy);
    const step = GRAPPLE.HOOK_TRAVEL_SPEED * dt;
    if (distance <= step) {
      this.hookPos.set(this.anchor.x, this.anchor.y);
      this.phase = WirePhase.Attached;
      this.player.swinging = true;
      const rope = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.anchor.x, this.anchor.y);
      this.ropeLength = Phaser.Math.Clamp(rope, GRAPPLE.MIN_LENGTH, GRAPPLE.MAX_LENGTH);
      this.playSound(AudioKeys.WireAttach);
      return;
    }
    this.hookPos.x += (dx / distance) * step;
    this.hookPos.y += (dy / distance) * step;
  }

  private applySwingPhysics(input: GrappleInput, dt: number, dtMs: number, nowMs: number): void {
    const maintenancePaid = this.gas.drain(GAS.COST_SWING_PER_SEC, dtMs, nowMs);
    if (maintenancePaid < 1) {
      this.clear(true);
      return;
    }
    const body = this.player.body;
    if (this.nodeHooked) {
      this.ropeLength = Math.max(GRAPPLE.NODE_MIN_LENGTH, this.ropeLength - GRAPPLE.NODE_REEL_SPEED * dt);
    } else if (input.reelIn || input.reelOut) {
      const paid = this.gas.drain(GAS.COST_REEL_PER_SEC, dtMs, nowMs);
      if (paid > 0) {
        const reelIn = input.reelIn;
        const speed = reelIn ? GRAPPLE.REEL_IN_SPEED : GRAPPLE.REEL_OUT_SPEED;
        const next = reelStep(
          this.player.x, this.player.y, this.anchor.x, this.anchor.y, reelIn, speed, dt * paid,
          GRAPPLE.MIN_LENGTH, GRAPPLE.MAX_LENGTH,
        );
        this.player.setPosition(next.x, next.y);
        this.ropeLength = next.ropeLength;
        this.maybeWhoosh(nowMs);
      }
    }

    let rx = this.player.x - this.anchor.x;
    let ry = this.player.y - this.anchor.y;
    let distance = Math.hypot(rx, ry) || 0.0001;
    const pull = nodeFlingAccel(GRAPPLE.PULL_ACCEL, GRAPPLE.NODE_PULL_ACCEL, this.nodeHooked) * dt;
    body.velocity.x -= (rx / distance) * pull;
    body.velocity.y -= (ry / distance) * pull;
    if (distance > this.ropeLength) {
      const nx = rx / distance;
      const ny = ry / distance;
      const correction = (distance - this.ropeLength) * GRAPPLE.CONSTRAINT_STIFFNESS;
      this.player.x -= nx * correction;
      this.player.y -= ny * correction;
      const outward = body.velocity.x * nx + body.velocity.y * ny;
      if (outward > 0) {
        body.velocity.x -= outward * nx;
        body.velocity.y -= outward * ny;
      }
      rx = this.player.x - this.anchor.x;
      ry = this.player.y - this.anchor.y;
      distance = Math.hypot(rx, ry) || 0.0001;
    }
    const damping = Math.max(0, 1 - GRAPPLE.SWING_DAMPING * dt);
    const nx = rx / distance;
    const ny = ry / distance;
    const radial = body.velocity.x * nx + body.velocity.y * ny;
    body.velocity.x = radial * nx + (body.velocity.x - radial * nx) * damping;
    body.velocity.y = radial * ny + (body.velocity.y - radial * ny) * damping;
  }

  private raycast(originX: number, originY: number, aimX: number, aimY: number): RayHit | null {
    const dx = aimX - originX;
    const dy = aimY - originY;
    const length = Math.hypot(dx, dy);
    if (length < 1) return null;
    const dirX = dx / length;
    const dirY = dy / length;
    let bestDistance = Infinity;
    let best: RayHit | null = null;
    const consider = (
      bounds: Phaser.Geom.Rectangle,
      target: GrappleTarget | null,
      surface: GrappleSurface | null,
    ): void => {
      const hit = rayAabbIntersection(originX, originY, dirX, dirY, GRAPPLE.RANGE, {
        left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom,
      });
      if (!hit || hit.distance >= bestDistance) return;
      bestDistance = hit.distance;
      best = { point: new Phaser.Math.Vector2(hit.point.x, hit.point.y), target, surface };
    };
    for (const surface of this.surfaces) if (surface.isValid) consider(surface.bounds, null, surface);
    for (const target of this.targets) if (target.isValid) consider(target.bounds, target, null);
    return best;
  }

  private render(): void {
    this.wire.clear();
    if (this.phase === WirePhase.Idle) return;
    const tip = this.phase === WirePhase.Firing ? this.hookPos : this.anchor;
    this.wire.lineStyle(GRAPPLE.WIRE_THICKNESS, GRAPPLE.WIRE_COLOR, 1);
    this.wire.lineBetween(this.player.x, this.player.y, tip.x, tip.y);
    if (this.phase === WirePhase.Attached) {
      this.wire.fillStyle(GRAPPLE.WIRE_COLOR, 1);
      this.wire.fillCircle(this.anchor.x, this.anchor.y, GRAPPLE.ANCHOR_RADIUS);
    }
  }

  private maybeWhoosh(nowMs: number): void {
    if (nowMs - this.whooshAt < 260) return;
    this.whooshAt = nowMs;
    this.playSound(AudioKeys.SwingWhoosh, 0.5);
  }
  private playSound(key: AudioKey, volume = 0.6): void { this.audio.playSfx(key, volume); }
  destroy(): void { this.wire.destroy(); this.aimGfx.destroy(); }
}
