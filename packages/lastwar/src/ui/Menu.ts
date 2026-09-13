import Phaser from 'phaser';
import { PALETTE } from '../config/GameConfig';
import { AudioKeys } from '../config/AssetKeys';
import { AudioManager } from '../systems/AudioManager';
import { textStyle } from './UiText';
import { addAccessibleButton } from '../systems/Accessibility';

const transitioningScenes = new WeakSet<Phaser.Scene>();

/** Options for a pixel-styled menu button. */
export interface ButtonOptions {
  /** Font size in px (default 20). */
  fontSize?: number;
  /** Horizontal padding around the label, px (default 20). */
  padX?: number;
  /** Vertical padding around the label, px (default 10). */
  padY?: number;
  /** Fixed width; if omitted the button hugs its label + padding. */
  width?: number;
  /** Fixed height; if omitted the button hugs its label + padding. */
  height?: number;
  /** Accent (border/hover) colour override, 0xRRGGBB. */
  accent?: number;
  /**
   * Opt out of the {@link UI_MIN_FONT_SIZE} floor in {@link textStyle}. Set on
   * the pre-existing sub-18 buttons in the dense meta scenes (Heroes/Missions
   * tabs, per-row action buttons, etc.) so they keep their original compact
   * size inside their fixed-width boxes instead of being silently enlarged.
   */
  allowSmall?: boolean;
}

/** The composite object returned for a button. */
export interface MenuButton {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  /** Replace the button's text. */
  setText(text: string): void;
  /** Enable/disable the button: disabled buttons grey out and ignore clicks. */
  setEnabled(enabled: boolean): void;
  /** Whether the button currently accepts input. */
  readonly enabled: boolean;
}

/** A drawable, updatable progress bar (fill 0..1). */
export interface ProgressBar {
  container: Phaser.GameObjects.Container;
  /** Set the fill fraction in [0..1]. */
  setProgress(fraction: number): void;
  /** Recolour the fill. */
  setFillColor(color: number): void;
}

/**
 * Menu - shared pixel-UI helpers so the Title / Upgrade / Settings / Results
 * screens share one cohesive modern military-survival look (palette, fonts,
 * button feel, panels, progress bars, fade transitions).
 */
export const Menu = {
  /**
   * Standard pixel title text. Titles are always large (default 48), well above
   * the {@link UI_MIN_FONT_SIZE} floor, but the `allowSmall` opt-out is exposed
   * for the handful of dense meta-scene sub-headings authored below 18.
   */
  title(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    size = 48,
    allowSmall = false,
  ): Phaser.GameObjects.Text {
    return scene.add
      .text(x, y, text, textStyle(size, { fontStyle: 'bold', color: PALETTE.TEXT_CSS, allowSmall }))
      .setOrigin(0.5)
      .setShadow(3, 3, '#000000', 4);
  },

  /**
   * Muted body/label text. Pass `allowSmall: true` to opt a sub-18 size out of
   * the {@link UI_MIN_FONT_SIZE} floor (used by the dense meta scenes whose
   * compact captions must stay their authored size); the in-scope primary-flow
   * text omits it and is floored/raised as intended.
   */
  label(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    size = 18,
    alpha = 0.9,
    allowSmall = false,
  ): Phaser.GameObjects.Text {
    return scene.add.text(x, y, text, textStyle(size, { allowSmall })).setOrigin(0.5).setAlpha(alpha);
  },

  /**
   * A framed panel rectangle in the dark HUD palette. Returns the rectangle so
   * callers can reposition/resize it.
   */
  panel(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    alpha = 0.96,
  ): Phaser.GameObjects.Rectangle {
    const panel = scene.add.rectangle(x, y, width, height, PALETTE.PANEL, alpha).setOrigin(0.5);
    panel.setStrokeStyle(2, PALETTE.ACCENT);
    return panel;
  },

  /**
   * A clickable pixel button: a bordered panel with a centered label that
   * lights up on hover and plays the UI click SFX on press. Returns a handle so
   * callers can relabel or enable/disable it (e.g. an unaffordable Upgrade).
   */
  button(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    onClick: () => void,
    opts: ButtonOptions = {},
  ): MenuButton {
    const fontSize = opts.fontSize ?? 20;
    const padX = opts.padX ?? 20;
    const padY = opts.padY ?? 10;
    const accent = opts.accent ?? PALETTE.ACCENT;

    const label = scene.add.text(0, 0, text, textStyle(fontSize, { allowSmall: opts.allowSmall })).setOrigin(0.5);

    const w = Math.max(44, opts.width ?? Math.ceil(label.width) + padX * 2);
    const h = Math.max(44, opts.height ?? Math.ceil(label.height) + padY * 2);

    const bg = scene.add.rectangle(0, 0, w, h, PALETTE.PANEL).setOrigin(0.5);
    bg.setStrokeStyle(2, accent);

    const container = scene.add.container(x, y, [bg, label]);
    container.setSize(w, h);
    // Derive the hit box from setSize rather than passing an explicit
    // Geom.Rectangle. InputManager.pointWithinHitArea already normalizes the
    // local pointer by displayOrigin (half the container size), so a CENTRE-based
    // rect like `Rectangle(-w/2, -h/2, w, h)` applies that shift twice and the
    // clickable region lands (-w/2, -h/2) off, overlapping only the button's
    // top-left quadrant. useHandCursor also gives the pointer feedback that a
    // canvas otherwise has no equivalent of.
    container.setInteractive({ useHandCursor: true });

    // Only the topmost interactive object under the pointer should fire, so a
    // passive/transparent rect under a button can never steal its press.
    scene.input.setTopOnly(true);

    let enabled = true;

    container.on(Phaser.Input.Events.POINTER_OVER, () => {
      if (!enabled) return;
      bg.setFillStyle(PALETTE.ROAD);
      bg.setStrokeStyle(2, PALETTE.TEXT);
      scene.tweens.add({ targets: container, scale: 1.05, duration: 90 });
    });
    container.on(Phaser.Input.Events.POINTER_OUT, () => {
      if (!enabled) return;
      bg.setFillStyle(PALETTE.PANEL);
      bg.setStrokeStyle(2, accent);
      scene.tweens.add({ targets: container, scale: 1, duration: 90 });
    });

    // Fire onClick synchronously ON PRESS; the squash is purely cosmetic and
    // never gates the action. A per-press latch guards double-fires.
    let fired = false;
    const arm = (): void => {
      fired = false;
    };
    container.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (!enabled || fired) return;
      fired = true;
      AudioManager.get(scene).playSfx(AudioKeys.UiClick, 0.7);
      scene.tweens.add({ targets: container, scale: 0.94, duration: 60, yoyo: true });
      onClick();
    });
    container.on(Phaser.Input.Events.POINTER_UP, arm);
    container.on(Phaser.Input.Events.POINTER_OUT, arm);

    const removeAccessible = addAccessibleButton(text, () => {
      if (enabled) onClick();
    });
    container.once(Phaser.GameObjects.Events.DESTROY, removeAccessible);

    const setEnabled = (next: boolean): void => {
      enabled = next;
      container.setAlpha(next ? 1 : 0.45);
      bg.setFillStyle(PALETTE.PANEL);
      bg.setStrokeStyle(2, next ? accent : PALETTE.ROAD_DARK);
      label.setColor(next ? PALETTE.TEXT_CSS : PALETTE.MUTED_CSS);
      if (next) container.setInteractive();
      else container.disableInteractive();
    };

    return {
      container,
      label,
      setText: (t: string) => label.setText(t),
      setEnabled,
      get enabled() {
        return enabled;
      },
    };
  },

  /**
   * A framed horizontal progress bar. `setProgress(0..1)` sets the fill width;
   * `setFillColor` recolours it.
   */
  progressBar(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height = 12,
    fillColor: number = PALETTE.ACCENT,
  ): ProgressBar {
    const border = scene.add.rectangle(0, 0, width + 4, height + 4, PALETTE.ROAD_DARK).setOrigin(0, 0.5);
    border.setStrokeStyle(2, PALETTE.LANE_LINE);
    const fill = scene.add.rectangle(2, 0, 1, height, fillColor).setOrigin(0, 0.5);
    const container = scene.add.container(x, y, [border, fill]);

    return {
      container,
      setProgress: (fraction: number) => {
        const clamped = Phaser.Math.Clamp(fraction, 0, 1);
        fill.width = Math.max(1, Math.floor(width * clamped));
      },
      setFillColor: (color: number) => fill.setFillStyle(color),
    };
  },

  /** Fade the camera in from black on scene create. Call at the top of create(). */
  fadeIn(scene: Phaser.Scene, durationMs = 350): void {
    const duration = AudioManager.get(scene).getSettings().reducedMotion ? Math.min(100, durationMs) : durationMs;
    scene.cameras.main.fadeIn(duration, 0, 0, 0);
  },

  /**
   * Fade to black then run `then` (typically a scene.start). Guards against
   * double-fires so a button can't queue two transitions.
   */
  fadeTo(scene: Phaser.Scene, then: () => void, durationMs = 300): void {
    if (transitioningScenes.has(scene)) return;
    transitioningScenes.add(scene);
    const cam = scene.cameras.main;
    const duration = AudioManager.get(scene).getSettings().reducedMotion ? Math.min(100, durationMs) : durationMs;
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      transitioningScenes.delete(scene);
      then();
    });
    cam.fadeOut(duration, 0, 0, 0);
  },
} as const;
