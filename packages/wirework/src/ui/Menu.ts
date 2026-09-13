import Phaser from 'phaser';
import { PALETTE } from '../config/GameConfig';
import { AudioKeys } from '../config/AssetKeys';
import { AudioManager } from '../systems/AudioManager';
import { prefersReducedMotion } from '../systems/Persistence';
import { textStyle } from './UiText';

export interface ButtonOptions { fontSize?: number; padX?: number; padY?: number; width?: number; accessibleLabel?: string }
export interface MenuButton {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  setText(text: string): void;
  setAccessibleLabel(text: string): void;
}
interface FocusEntry { container: Phaser.GameObjects.Container; bg: Phaser.GameObjects.Rectangle; activate: () => void; mirror: HTMLButtonElement | null }
interface FocusState { entries: FocusEntry[]; index: number; installed: boolean; root: HTMLElement | null }
const states = new WeakMap<Phaser.Scene, FocusState>();

function setMirrorActive(root: HTMLElement | null, active: boolean): void {
  if (!root) return;
  root.hidden = !active;
  root.toggleAttribute('inert', !active);
}

function focusState(scene: Phaser.Scene): FocusState {
  let state = states.get(scene);
  if (state) return state;
  let root: HTMLElement | null = null;
  if (typeof document !== 'undefined') {
    const host = document.getElementById('a11y-controls');
    if (host) {
      root = document.createElement('section');
      root.dataset.scene = scene.scene.key;
      host.append(root);
    }
  }
  state = { entries: [], index: -1, installed: false, root };
  states.set(scene, state);
  scene.events.on(Phaser.Scenes.Events.SLEEP, () => setMirrorActive(state?.root ?? null, false));
  scene.events.on(Phaser.Scenes.Events.WAKE, () => setMirrorActive(state?.root ?? null, true));
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    state?.root?.remove();
    states.delete(scene);
  });
  return state;
}

function setFocus(state: FocusState, index: number): void {
  if (state.entries.length === 0) return;
  state.index = ((index % state.entries.length) + state.entries.length) % state.entries.length;
  state.entries.forEach((entry, entryIndex) => {
    entry.bg.setStrokeStyle(entryIndex === state.index ? 4 : 2, entryIndex === state.index ? PALETTE.TEXT : PALETTE.ACCENT);
  });
  state.entries[state.index].mirror?.focus({ preventScroll: true });
}

function installKeyboardNavigation(scene: Phaser.Scene, state: FocusState): void {
  if (state.installed) return;
  state.installed = true;
  scene.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Tab' || event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      setFocus(state, state.index + 1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setFocus(state, state.index - 1);
    } else if ((event.key === 'Enter' || event.key === ' ') && state.index >= 0) {
      event.preventDefault();
      state.entries[state.index].activate();
    }
  });
}

function mirrorButton(scene: Phaser.Scene, text: string, activate: () => void): HTMLButtonElement | null {
  const state = focusState(scene);
  if (!state.root) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.addEventListener('click', () => { if (scene.scene.isActive()) activate(); });
  state.root.append(button);
  return button;
}

function mirrorText(scene: Phaser.Scene, text: string, heading: boolean): void {
  const root = focusState(scene).root;
  if (!root) return;
  const element = document.createElement(heading ? 'h2' : 'p');
  element.textContent = text;
  if (heading) root.setAttribute('aria-label', text);
  root.append(element);
}

export const Menu = {
  title(scene: Phaser.Scene, x: number, y: number, text: string, size = 56): Phaser.GameObjects.Text {
    mirrorText(scene, text, true);
    return scene.add.text(x, y, text, textStyle(size, { fontStyle: 'bold' })).setOrigin(0.5);
  },

  label(scene: Phaser.Scene, x: number, y: number, text: string, size = 18, alpha = 0.85): Phaser.GameObjects.Text {
    mirrorText(scene, text, false);
    return scene.add.text(x, y, text, textStyle(size)).setOrigin(0.5).setAlpha(alpha);
  },

  button(scene: Phaser.Scene, x: number, y: number, text: string, onClick: () => void, opts: ButtonOptions = {}): MenuButton {
    const label = scene.add.text(0, 0, text, textStyle(opts.fontSize ?? 20)).setOrigin(0.5);
    const width = opts.width ?? Math.ceil(label.width) + (opts.padX ?? 20) * 2;
    const height = Math.ceil(label.height) + (opts.padY ?? 10) * 2;
    const bg = scene.add.rectangle(0, 0, width, height, PALETTE.BG_NEAR).setStrokeStyle(2, PALETTE.ACCENT);
    // Derive the hit box from setSize instead of passing an explicit
    // Geom.Rectangle. Phaser's InputManager.pointWithinHitArea already
    // normalizes the local pointer by the object's displayOrigin (half the
    // container size), so handing it a CENTRE-based rect like
    // `Rectangle(-w/2, -h/2, w, h)` applies that half-size shift TWICE: the
    // clickable region ends up offset by (-w/2, -h/2) and only overlaps the
    // button's top-left quadrant. Measured on the title screen before this fix:
    // the 335x66 "출격" button was only clickable 124px left and 33px above
    // where it was drawn. setSize-derived hit boxes are already origin-correct,
    // and useHandCursor gives the pointer feedback a canvas otherwise lacks.
    const container = scene.add.container(x, y, [bg, label]).setSize(width, height)
      .setInteractive({ useHandCursor: true });
    scene.input.setTopOnly(true);
    const reduced = prefersReducedMotion(AudioManager.get(scene).getSettings());
    let fired = false;
    const activate = (): void => {
      if (fired) return;
      fired = true;
      AudioManager.get(scene).playSfx(AudioKeys.UiClick, 0.7);
      if (!reduced) scene.tweens.add({ targets: container, scale: 0.94, duration: 60, yoyo: true });
      onClick();
      scene.time.delayedCall(0, () => { fired = false; });
    };
    container.on(Phaser.Input.Events.POINTER_OVER, () => {
      bg.setFillStyle(PALETTE.BG_FAR);
      const state = focusState(scene);
      setFocus(state, state.entries.findIndex((entry) => entry.container === container));
      if (!reduced) scene.tweens.add({ targets: container, scale: 1.06, duration: 80 });
    });
    container.on(Phaser.Input.Events.POINTER_OUT, () => {
      bg.setFillStyle(PALETTE.BG_NEAR);
      if (!reduced) scene.tweens.add({ targets: container, scale: 1, duration: 80 });
    });
    container.on(Phaser.Input.Events.POINTER_DOWN, activate);
    const state = focusState(scene);
    const mirror = mirrorButton(scene, text, activate);
    if (mirror && opts.accessibleLabel) mirror.setAttribute('aria-label', `${opts.accessibleLabel}: ${text}`);
    state.entries.push({ container, bg, activate, mirror });
    mirror?.addEventListener('focus', () => setFocus(state, state.entries.findIndex((entry) => entry.container === container)));
    installKeyboardNavigation(scene, state);
    if (state.index < 0) setFocus(state, 0);
    return {
      container,
      label,
      setText: (value) => {
        label.setText(value);
        if (mirror) {
          mirror.textContent = value;
          if (opts.accessibleLabel) mirror.setAttribute('aria-label', `${opts.accessibleLabel}: ${value}`);
        }
      },
      setAccessibleLabel: (value) => mirror?.setAttribute('aria-label', value),
    };
  },

  fadeIn(scene: Phaser.Scene, durationMs = 350): void {
    const reduced = prefersReducedMotion(AudioManager.get(scene).getSettings());
    scene.cameras.main.fadeIn(reduced ? Math.min(80, durationMs) : durationMs, 0, 0, 0);
  },

  fadeTo(scene: Phaser.Scene, then: () => void, durationMs = 300): void {
    const camera = scene.cameras.main;
    const reduced = prefersReducedMotion(AudioManager.get(scene).getSettings());
    camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, then);
    camera.fadeOut(reduced ? Math.min(80, durationMs) : durationMs, 0, 0, 0);
  },
} as const;
