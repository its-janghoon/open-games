import Phaser from 'phaser';

export interface AccessibleControl {
  setLabel(label: string): void;
  setDisabled(disabled: boolean): void;
  setDescription(description: string): void;
  remove(): void;
}

export interface AccessibleRange extends AccessibleControl {
  setValue(value: number): void;
}

export interface AccessibleModal {
  focusFirst(): void;
  close(): void;
}

let activeModalHost: HTMLElement | null = null;

/**
 * Whether the last input the user gave was a key rather than a pointer.
 *
 * This gates whether opening a canvas modal MOVES focus into it. Moving focus is
 * right for someone navigating by keyboard or with a screen reader, but the
 * mirrored control reveals itself on `:focus-visible`, and a programmatic
 * `.focus()` satisfies that even when the modal was opened by a mouse click - so
 * a sighted mouse user got a high-contrast label chip planted over the top of the
 * HUD. That is what the reported overlap actually was: a "용광로" box sitting
 * inside the resource bar, not a mislaid game object.
 *
 * The modal is still announced either way - it carries role="dialog" and
 * aria-modal, and Tab reaches it because it is in the DOM. Only the automatic
 * focus jump is withheld from pointer users.
 */
let lastInputWasKeyboard = false;
let modalityBound = false;

function trackInputModality(): void {
  if (modalityBound || typeof document === 'undefined') return;
  modalityBound = true;
  document.addEventListener('keydown', () => { lastInputWasKeyboard = true; }, true);
  for (const event of ['pointerdown', 'mousedown', 'touchstart'] as const) {
    document.addEventListener(event, () => { lastInputWasKeyboard = false; }, true);
  }
}

function root(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  trackInputModality();
  let node = document.getElementById('a11y-controls');
  if (!node) {
    node = document.createElement('nav');
    node.id = 'a11y-controls';
    node.setAttribute('aria-label', document.documentElement.lang === 'ko' ? '서리성채 조작' : 'Frosthold controls');
    document.body.appendChild(node);
  }
  return node;
}

function inertControl(): AccessibleControl {
  return {
    setLabel: () => undefined,
    setDisabled: () => undefined,
    setDescription: () => undefined,
    remove: () => undefined,
  };
}

function bindLifecycle(scene: Phaser.Scene, element: HTMLElement): () => void {
  const remove = (): void => element.remove();
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, remove);
  return remove;
}

/** Mirror a canvas button into a semantic, keyboard-operable DOM control. */
export function mirrorButton(scene: Phaser.Scene, label: string, activate: () => void): AccessibleControl {
  const host = root();
  if (!host) return inertControl();
  const button = document.createElement('button');
  button.className = 'canvas-a11y-button';
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', activate);
  (activeModalHost ?? host).appendChild(button);
  const remove = bindLifecycle(scene, button);
  return {
    setLabel: (next) => { button.textContent = next; button.setAttribute('aria-label', next); },
    setDisabled: (disabled) => { button.disabled = disabled; button.setAttribute('aria-disabled', String(disabled)); },
    setDescription: (description) => {
      if (description) button.setAttribute('aria-description', description);
      else button.removeAttribute('aria-description');
    },
    remove,
  };
}

/** Mirror a canvas slider as a native range input with full keyboard support. */
export function mirrorRange(
  scene: Phaser.Scene,
  label: string,
  initial: number,
  onChange: (value: number) => void,
): AccessibleRange {
  const host = root();
  if (!host || typeof document === 'undefined') {
    return { ...inertControl(), setValue: () => undefined };
  }
  const input = document.createElement('input');
  input.className = 'canvas-a11y-button';
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.value = String(Math.round(Math.min(1, Math.max(0, initial)) * 100));
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => onChange(Number(input.value) / 100));
  (activeModalHost ?? host).appendChild(input);
  const remove = bindLifecycle(scene, input);
  return {
    setLabel: (next) => input.setAttribute('aria-label', next),
    setDisabled: (disabled) => { input.disabled = disabled; input.setAttribute('aria-disabled', String(disabled)); },
    setDescription: (description) => {
      if (description) input.setAttribute('aria-description', description);
      else input.removeAttribute('aria-description');
    },
    setValue: (value) => { input.value = String(Math.round(Math.min(1, Math.max(0, value)) * 100)); },
    remove,
  };
}

/** Isolate a transient canvas modal, trap keyboard focus, then restore it. */
export function beginModal(scene: Phaser.Scene, label: string): AccessibleModal {
  const host = root();
  if (!host || typeof document === 'undefined') return { focusFirst: () => undefined, close: () => undefined };
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const background = Array.from(host.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  for (const child of background) {
    child.inert = true;
    child.setAttribute('aria-hidden', 'true');
  }
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', label);
  host.appendChild(dialog);
  activeModalHost = dialog;

  const focusables = (): HTMLElement[] => Array.from(dialog.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])'))
    .filter((element) => !element.hasAttribute('disabled'));
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (current <= 0 ? items.length - 1 : current - 1)
      : (current < 0 || current >= items.length - 1 ? 0 : current + 1);
    event.preventDefault();
    items[next].focus();
  };
  dialog.addEventListener('keydown', onKeyDown);
  let closed = false;
  let movedFocus = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    dialog.removeEventListener('keydown', onKeyDown);
    dialog.remove();
    if (activeModalHost === dialog) activeModalHost = null;
    for (const child of background) {
      child.inert = false;
      child.removeAttribute('aria-hidden');
    }
    // Only hand focus back if we took it. Restoring focus we never moved would
    // itself plant a visible chip on a mouse user, which is the bug this guards.
    if (movedFocus) previousFocus?.focus();
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, close);
  return {
    focusFirst: () => {
      if (!lastInputWasKeyboard) return;
      queueMicrotask(() => {
        const first = focusables()[0];
        if (!first) return;
        movedFocus = true;
        first.focus();
      });
    },
    close,
  };
}

/** Announce status/error/result changes without requiring canvas inspection. */
export function announce(message: string, assertive = false): void {
  if (typeof document === 'undefined') return;
  let region = document.getElementById('a11y-live');
  if (!region) {
    region = document.createElement('div');
    region.id = 'a11y-live';
    region.className = 'sr-only';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-atomic', 'true');
    document.body.appendChild(region);
  }
  region.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  region.textContent = '';
  queueMicrotask(() => { if (region) region.textContent = message; });
}
