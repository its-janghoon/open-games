import Phaser from 'phaser';
import { mapDragToMove } from '@open-games/shared';
import { CANVAS, PALETTE } from '../config/GameConfig';

/**
 * TOUCH CONTROLS.
 *
 * Wirework's README used to state plainly that "Touch gameplay is not
 * supported": `GameScene` bailed out of every gameplay pointer handler with
 * `if (pointer.wasTouch) return;`, so a phone could open the menus and nothing
 * else. That disqualifies the game from the web-portal market, where a large
 * share of traffic is mobile, so this module adds a real touch scheme rather
 * than a keyboard emulation.
 *
 * Scheme - two thumbs, screen split down the middle:
 *
 *   LEFT half   floating virtual STICK. First touch anchors the base wherever
 *               the thumb lands (no fixed pad to find), and the drag vector is
 *               run through the shared {@link mapDragToMove} so the deadzone and
 *               saturation radius match the other games' touch feel. The
 *               simulation takes booleans, so the analogue vector is thresholded
 *               back into up/down/left/right.
 *
 *   RIGHT half  AIM + TETHER. Touching aims; holding is the tether (same
 *               semantics as holding mouse-left), and releasing flings. This is
 *               the core mechanic, so it gets the whole half rather than a
 *               button.
 *
 *   BUTTONS     DASH and CUT, bottom-right, above the aim area. Reeling
 *               (Q/E on desktop) is intentionally NOT surfaced: it is a
 *               refinement, and a fifth control would crowd the thumb.
 *
 * All visuals are `setScrollFactor(0)` overlays in the 960x540 logical space, so
 * they ride the camera and inherit the game's existing scale plan.
 */

/** Radius (logical px) at which a stick drag reaches full tilt. */
const STICK_RADIUS = 64;
/** Drag below this (logical px) reads as no movement. */
const STICK_DEADZONE = 10;
/** Analogue-to-boolean threshold; below this an axis is not pressed. */
const AXIS_THRESHOLD = 0.32;
const BUTTON_RADIUS = 34;
const BUTTON_MARGIN = 18;

export interface TouchMoveState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** True when the device reports touch support at all. */
export function touchAvailable(scene: Phaser.Scene): boolean {
  if (scene.sys.game.device.input.touch) return true;
  return typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0;
}

export interface TouchControlsCallbacks {
  /** Fired when the aim half is first pressed: begin the tether. */
  onTetherStart: (aimX: number, aimY: number) => void;
  /** Fired when the aim half is released: fling. */
  onTetherRelease: () => void;
  onDash: () => void;
  onCut: (aimX: number, aimY: number) => void;
  /** Translate a screen point into the world point the sim aims with. */
  toWorld: (screenX: number, screenY: number) => { x: number; y: number };
}

export class TouchControls {
  private readonly scene: Phaser.Scene;
  private readonly cb: TouchControlsCallbacks;

  /** Pointer id currently driving the movement stick, if any. */
  private stickPointer: number | null = null;
  private stickBaseX = 0;
  private stickBaseY = 0;
  private move: TouchMoveState = { up: false, down: false, left: false, right: false };

  /** Pointer id currently driving aim/tether, if any. */
  private aimPointer: number | null = null;
  private aimWorld = { x: 0, y: 0 };
  private tetherHeld = false;

  private stickBase!: Phaser.GameObjects.Arc;
  private stickKnob!: Phaser.GameObjects.Arc;
  private dashButton!: Phaser.GameObjects.Container;
  private cutButton!: Phaser.GameObjects.Container;
  private dashBounds!: Phaser.Geom.Circle;
  private cutBounds!: Phaser.Geom.Circle;

  constructor(scene: Phaser.Scene, callbacks: TouchControlsCallbacks) {
    this.scene = scene;
    this.cb = callbacks;
    this.buildVisuals();
    this.bindPointers();
  }

  /** Movement booleans for this frame, OR-ed into the sim input by the scene. */
  get moveState(): TouchMoveState {
    return this.move;
  }

  /** Whether the tether is being held on touch. */
  get holdingTether(): boolean {
    return this.tetherHeld;
  }

  /** Latest touch aim in WORLD space, or null when no aim touch is active. */
  get aim(): { x: number; y: number } | null {
    return this.aimPointer === null ? null : this.aimWorld;
  }

  private buildVisuals() {
    const s = this.scene;
    this.stickBase = s.add
      .circle(0, 0, STICK_RADIUS, PALETTE.WALL_DARK, 0.28)
      .setStrokeStyle(2, PALETTE.PLAYER, 0.55)
      .setScrollFactor(0)
      .setDepth(9000)
      .setVisible(false);
    this.stickKnob = s.add
      .circle(0, 0, 22, PALETTE.PLAYER, 0.65)
      .setScrollFactor(0)
      .setDepth(9001)
      .setVisible(false);

    const cutX = CANVAS.WIDTH - BUTTON_MARGIN - BUTTON_RADIUS;
    const cutY = CANVAS.HEIGHT - BUTTON_MARGIN - BUTTON_RADIUS;
    const dashX = cutX - BUTTON_RADIUS * 2 - 14;
    const dashY = cutY;
    this.cutButton = this.makeButton(cutX, cutY, 'CUT');
    this.dashButton = this.makeButton(dashX, dashY, 'DASH');
    this.cutBounds = new Phaser.Geom.Circle(cutX, cutY, BUTTON_RADIUS + 6);
    this.dashBounds = new Phaser.Geom.Circle(dashX, dashY, BUTTON_RADIUS + 6);
  }

  private makeButton(x: number, y: number, label: string): Phaser.GameObjects.Container {
    const s = this.scene;
    const disc = s.add
      .circle(0, 0, BUTTON_RADIUS, PALETTE.WALL_DARK, 0.42)
      .setStrokeStyle(2, PALETTE.ACCENT, 0.7);
    const text = s.add
      .text(0, 0, label, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: PALETTE.TEXT_CSS,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    return s.add.container(x, y, [disc, text]).setScrollFactor(0).setDepth(9000);
  }

  private bindPointers() {
    const s = this.scene;
    s.input.addPointer(2); // support three simultaneous touches (stick + aim + button)
    s.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    s.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    s.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    s.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
  }

  private onDown(pointer: Phaser.Input.Pointer) {
    if (!pointer.wasTouch) return;
    const x = pointer.x;
    const y = pointer.y;

    // Buttons win over the aim half so a thumb on DASH does not also tether.
    if (this.dashBounds.contains(x, y)) {
      this.cb.onDash();
      return;
    }
    if (this.cutBounds.contains(x, y)) {
      const w = this.cb.toWorld(x, y);
      this.cb.onCut(w.x, w.y);
      return;
    }

    if (x < CANVAS.WIDTH / 2) {
      if (this.stickPointer !== null) return;
      this.stickPointer = pointer.id;
      this.stickBaseX = x;
      this.stickBaseY = y;
      this.stickBase.setPosition(x, y).setVisible(true);
      this.stickKnob.setPosition(x, y).setVisible(true);
      return;
    }

    if (this.aimPointer !== null) return;
    this.aimPointer = pointer.id;
    this.aimWorld = this.cb.toWorld(x, y);
    this.tetherHeld = true;
    this.cb.onTetherStart(this.aimWorld.x, this.aimWorld.y);
  }

  private onMove(pointer: Phaser.Input.Pointer) {
    if (!pointer.wasTouch) return;
    if (pointer.id === this.stickPointer) {
      const dx = pointer.x - this.stickBaseX;
      const dy = pointer.y - this.stickBaseY;
      const intent = mapDragToMove(dx, dy, STICK_DEADZONE, STICK_RADIUS);
      this.move = {
        left: intent.moveX < -AXIS_THRESHOLD,
        right: intent.moveX > AXIS_THRESHOLD,
        up: intent.moveY < -AXIS_THRESHOLD,
        down: intent.moveY > AXIS_THRESHOLD,
      };
      // Knob follows the thumb but is clamped inside the base ring.
      const dist = Math.hypot(dx, dy);
      const clamp = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
      this.stickKnob.setPosition(this.stickBaseX + dx * clamp, this.stickBaseY + dy * clamp);
      return;
    }
    if (pointer.id === this.aimPointer) {
      this.aimWorld = this.cb.toWorld(pointer.x, pointer.y);
    }
  }

  private onUp(pointer: Phaser.Input.Pointer) {
    if (!pointer.wasTouch) return;
    if (pointer.id === this.stickPointer) {
      this.stickPointer = null;
      this.move = { up: false, down: false, left: false, right: false };
      this.stickBase.setVisible(false);
      this.stickKnob.setVisible(false);
      return;
    }
    if (pointer.id === this.aimPointer) {
      this.aimPointer = null;
      this.tetherHeld = false;
      this.cb.onTetherRelease();
    }
  }

  /** Drop movement and the tether - used on focus loss / pause so nothing sticks. */
  reset() {
    this.stickPointer = null;
    this.aimPointer = null;
    this.tetherHeld = false;
    this.move = { up: false, down: false, left: false, right: false };
    this.stickBase.setVisible(false);
    this.stickKnob.setVisible(false);
  }

  destroy() {
    const s = this.scene;
    s.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    s.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    s.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    s.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    this.stickBase.destroy();
    this.stickKnob.destroy();
    this.dashButton.destroy();
    this.cutButton.destroy();
  }
}
