import {
  createAnswer,
  createOffer,
  participantFor,
  rtcAvailable,
  type PeerLink,
  type RtcTransport,
} from '@open-games/shared';

import type { FpsInput } from '../game/gridWorld';
import { tr, type Language } from '../i18n/strings';

/**
 * The connect panel: a DOM overlay for exchanging connection codes.
 *
 * DOM rather than drawn in Phaser, and that is a requirement rather than a convenience. A connection code is a few
 * hundred characters, so the player has to be able to SELECT and COPY one and PASTE the other. Phaser has no text
 * input — a scene would have to reimplement selection, the clipboard and an on-screen caret, and the result would
 * still not be reachable by a screen reader or usable on a phone keyboard. A textarea already is all of those.
 *
 * There is precedent in this repo for reaching for the DOM when the DOM is the right tool: the games already maintain
 * a DOM accessibility mirror, which is what once made a focus chip appear in a screenshot.
 *
 * Nothing here touches the simulation. The panel's only output is a PeerLink and which participant this side plays.
 */

export interface ConnectPanelOptions {
  language: Language;
  /** Called once a channel is open, with the link and the participant this side plays. */
  onConnected(link: PeerLink<FpsInput>, participant: 'p1' | 'p2'): void;
}

export interface ConnectPanel {
  /** Show the panel. Safe to call when the browser cannot do WebRTC — it reports that instead. */
  open(): void;
  close(): void;
  destroy(): void;
  readonly isOpen: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

const PANEL_BG = 'rgba(8, 11, 20, 0.94)';
const ACCENT = '#69ffa8';
const TEXT = '#dbe3ff';

export function createConnectPanel(options: ConnectPanelOptions): ConnectPanel {
  const { language } = options;
  let open = false;

  const root = el('div', {
    position: 'fixed',
    inset: '0',
    display: 'none',
    zIndex: '40',
    background: PANEL_BG,
    // The game canvas sits behind this; a scrollable column keeps the panel usable on a short viewport.
    overflowY: 'auto',
    padding: '24px',
    fontFamily: 'system-ui, sans-serif',
    color: TEXT,
  });
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');

  const card = el('div', {
    maxWidth: '620px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  });
  const title = el('h2', { margin: '0', fontSize: '20px', color: ACCENT }, tr('net.connectTitle', language));
  root.setAttribute('aria-label', tr('net.connectTitle', language));
  const blurb = el('p', { margin: '0', fontSize: '13px', lineHeight: '1.5', opacity: '0.85' },
    tr('net.connectBlurb', language));

  const status = el('p', { margin: '0', fontSize: '13px', minHeight: '18px', color: ACCENT }, '');
  status.setAttribute('role', 'status');

  const hostButton = el('button', buttonStyle(), tr('net.hostButton', language));
  const joinButton = el('button', buttonStyle(), tr('net.joinButton', language));
  const closeButton = el('button', buttonStyle(), tr('net.closeButton', language));

  const mineLabel = el('label', { fontSize: '12px', opacity: '0.8' }, tr('net.yourCode', language));
  const mine = el('textarea', textareaStyle());
  mine.readOnly = true;
  const theirsLabel = el('label', { fontSize: '12px', opacity: '0.8' }, tr('net.theirCode', language));
  const theirs = el('textarea', textareaStyle());
  const submit = el('button', buttonStyle(), tr('net.submitCode', language));

  const exchange = el('div', { display: 'none', flexDirection: 'column', gap: '6px' });
  exchange.append(mineLabel, mine, theirsLabel, theirs, submit);

  const buttons = el('div', { display: 'flex', gap: '8px', flexWrap: 'wrap' });
  buttons.append(hostButton, joinButton, closeButton);
  card.append(title, blurb, buttons, status, exchange);
  root.append(card);
  document.body.append(root);

  function buttonStyle(): Partial<CSSStyleDeclaration> {
    return {
      // 44px minimum because a control smaller than that is not reliably tappable — the same floor the games' own
      // menu buttons enforce.
      minHeight: '44px',
      padding: '10px 16px',
      fontSize: '14px',
      color: TEXT,
      background: '#1a2136',
      border: `1px solid ${ACCENT}`,
      borderRadius: '6px',
      cursor: 'pointer',
      fontFamily: 'inherit',
    };
  }

  function textareaStyle(): Partial<CSSStyleDeclaration> {
    return {
      width: '100%',
      minHeight: '92px',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '11px',
      lineHeight: '1.4',
      color: TEXT,
      background: '#0f1424',
      border: '1px solid #2a3450',
      borderRadius: '6px',
      padding: '8px',
      wordBreak: 'break-all',
    };
  }

  const say = (message: string) => {
    status.textContent = message;
  };

  /** Report a failure in the player's own terms. An exception here is almost always a mistyped or truncated code. */
  const fail = (error: unknown) => {
    say(error instanceof Error ? error.message : String(error));
  };

  let role: 'p1' | 'p2' = 'p1';
  let acceptAnswer: ((code: string) => Promise<void>) | null = null;

  const wire = (t: RtcTransport<FpsInput>) => {
    t.onLost((reason) => say(reason));
    void t.ready.then(() => {
      say(tr('net.connected', language, { role: tr(role === 'p1' ? 'net.roleHost' : 'net.roleGuest', language) }));
      options.onConnected(t.link, role);
      // Left open for a moment so the player sees it connected, then dismissed on its own.
      window.setTimeout(() => panel.close(), 1200);
    });
  };

  hostButton.addEventListener('click', () => {
    hostButton.disabled = true;
    joinButton.disabled = true;
    say(tr('net.gathering', language));
    void createOffer<FpsInput>()
      .then(async (offer) => {
        role = participantFor('offerer');
        mine.value = offer.code;
        acceptAnswer = offer.accept;
        exchange.style.display = 'flex';
        theirsLabel.textContent = tr('net.pasteAnswer', language);
        say(tr('net.shareYourCode', language));
        wire(offer.transport);
      })
      .catch(fail);
  });

  joinButton.addEventListener('click', () => {
    hostButton.disabled = true;
    joinButton.disabled = true;
    exchange.style.display = 'flex';
    mineLabel.textContent = tr('net.yourCode', language);
    mine.value = '';
    theirsLabel.textContent = tr('net.pasteOffer', language);
    say(tr('net.pasteOffer', language));
  });

  submit.addEventListener('click', () => {
    const code = theirs.value.trim();
    if (code === '') {
      say(tr('net.needCode', language));
      return;
    }
    if (acceptAnswer) {
      // Hosting: this is the answer coming back.
      void acceptAnswer(code).then(() => say(tr('net.finishing', language))).catch(fail);
      return;
    }
    // Joining: this is the offer, and answering it produces our own code to send back.
    say(tr('net.gathering', language));
    void createAnswer<FpsInput>(code)
      .then((answer) => {
        role = participantFor('answerer');
        mine.value = answer.code;
        say(tr('net.sendBackYourCode', language));
        wire(answer.transport);
      })
      .catch(fail);
  });

  closeButton.addEventListener('click', () => panel.close());
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') panel.close();
  });

  const panel: ConnectPanel = {
    open() {
      if (!rtcAvailable()) {
        // Said plainly rather than presenting a connect flow that cannot work.
        say(tr('net.unavailable', language));
      }
      root.style.display = 'block';
      open = true;
      // Focus moves into the dialog so keyboard and screen-reader users are not left outside it.
      hostButton.focus();
    },
    close() {
      root.style.display = 'none';
      open = false;
    },
    destroy() {
      // The transport is NOT closed here: a connected match must survive dismissing the panel that set it up.
      root.remove();
      open = false;
    },
    get isOpen() {
      return open;
    },
  };
  return panel;
}
