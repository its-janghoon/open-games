import Phaser from 'phaser';
import { RollbackSession } from '@open-games/shared';

import { GAME_HEIGHT, GAME_WIDTH } from '../config/GameConfig';
import { createGridSimulation } from '../game/gridSimulation';
import {
  isAlive,
  NEUTRAL_FPS_INPUT,
  RULES,
  type FpsInput,
  type GridWorld,
} from '../game/gridWorld';
import { castView, projectionDistance, shade, shadeColor, wallHeight } from '../game/raycast';
import { resolveLanguage, tr, type Language } from '../i18n/strings';
import { openTabTransport, tabTransportAvailable, type Role, type TabTransport } from '../net/tabTransport';
import { NetSession } from '@open-games/shared';
import { hashGridWorld } from '../game/gridSimulation';
import { FONT_STACK } from '../config/fontStack';
import { CueSynth } from '@open-games/shared';
import type { PeerLink } from '@open-games/shared';
import { createAnswer, createOffer, type RtcOptions } from '@open-games/shared';
import { createConnectPanel, type ConnectPanel } from '../net/connectPanel';

/**
 * The first-person view, drawn from geometry alone.
 *
 * One filled rectangle per column, two flat bands for floor and ceiling, and nothing else — no textures, no
 * models, no 3D scene graph. That is why gridfall's whole download is the Phaser engine: 357 KB, the same as
 * Ringout, against champs' 1.65 MB. On the metered connections this project targets, "the art is code" is a
 * budget decision before it is a style.
 *
 * The scene reads state and draws. Every rule lives in stepGrid, which is why that file is testable without
 * Phaser and this one needs no tests of its own — the arithmetic it would otherwise contain is in raycast.ts,
 * under seventeen tests.
 */

/**
 * Rays cast per frame.
 *
 * 240, not one per pixel. At 960 the cost is four times higher for a difference nobody can see at this scale:
 * each column is four pixels wide, and the walls are flat colour, so there is no detail for the extra rays to
 * resolve. The target is a cheap phone, and a raycaster's cost is linear in ray count — this is the single
 * biggest performance lever in the renderer, so it is set deliberately rather than left at the width.
 */
const COLUMNS = 240;
const COLUMN_WIDTH = GAME_WIDTH / COLUMNS;

/** Derived once: the eye-to-plane distance in pixels that turns a world distance into a wall height. */
const PROJECTION = projectionDistance(GAME_WIDTH);

const PALETTE = {
  /**
   * Kept darker than the floor so up and down still read differently at a glance, but no longer near-black.
   *
   * At 0x080b14 the upper half of every frame was effectively empty: the wall tops sit below the horizon in most
   * views, so a corridor shot was half black. It looked unfinished rather than atmospheric, which is the whole
   * difference between a game worth listing and a tech demo. Caught while framing the landing-page thumbnail
   * against the other five, all of which fill the card with the world.
   */
  ceiling: 0x151b2e,
  floor: 0x232b42,
  wall: 0x7aa2ff,
  otherPlayer: 0xffc45a,
  shot: 0xff5470,
  hpTrack: 0x1a2340,
  hpFill: 0x69ffa8,
  hpLow: 0xff5470,
  crosshair: 0xe9eeff,
} as const;

export class FpsScene extends Phaser.Scene {
  /**
   * Exactly one of these drives the match.
   *
   * A local session when this tab is alone (two players share the keyboard), a NetSession when a second tab
   * answered the handshake. They are kept as separate fields rather than behind one interface because they are
   * driven differently — a local session is told both players' inputs, a networked one is told only ours — and
   * hiding that behind a common shape would make the difference easy to get wrong silently.
   */
  private session?: RollbackSession<GridWorld, FpsInput>;
  private net?: NetSession<GridWorld, FpsInput>;
  private transport?: TabTransport;
  private role: Role = 'p1';
  private language: Language = 'ko';
  private statusText!: Phaser.GameObjects.Text;
  private desyncAt: number | null = null;
  private banner!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private rematchHint!: Phaser.GameObjects.Text;
  /** Set once the result has been shown, so the rematch is armed exactly once. */
  private resultShown = false;
  private readonly cues = new CueSynth();
  private connectPanel?: ConnectPanel;
  /**
   * The previously DRAWN state, for cue transitions.
   *
   * Not part of the simulation and deliberately not in the snapshot: nothing in the step reads it, and a rollback
   * must not rewind what the player has already heard.
   */
  private lastSeen: {
    shotIds: Set<string>;
    hp: number[];
    kills: number[];
    alive: boolean[];
    decided: boolean;
  } | null = null;
  private view!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  /**
   * Real time not yet spent as ticks.
   *
   * The simulation must advance in fixed steps or it is not reproducible, but a browser delivers frames at
   * whatever rate it manages. So time accumulates and is spent in whole ticks; a late frame runs several.
   */
  private carry = 0;

  constructor() {
    super('Fps');
  }

  create(): void {
    this.language = resolveLanguage();
    this.session = new RollbackSession(createGridSimulation(['p1', 'p2']), {
      participants: ['p1', 'p2'],
      maxRollbackTicks: 240,
    });
    this.connectIfAnotherTabIsOpen();

    this.cameras.main.setBackgroundColor(PALETTE.ceiling);
    this.view = this.add.graphics();
    this.hud = this.add.graphics();

    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard!.addKeys({
      forward: K.W,
      back: K.S,
      strafeLeft: K.A,
      strafeRight: K.D,
      turnLeft: K.LEFT,
      turnRight: K.RIGHT,
      turnLeftAlt: K.Q,
      turnRightAlt: K.E,
      fire: K.SPACE,
      // Player two, on the right-hand cluster. IJKL rather than the arrows because the arrows are already
      // player one's turn keys, and a shared keyboard where two players fight over the same key is worse than
      // an unfamiliar layout.
      p2Forward: K.I,
      p2Back: K.K,
      p2StrafeLeft: K.J,
      p2StrafeRight: K.L,
      p2TurnLeft: K.U,
      p2TurnRight: K.O,
      p2Fire: K.ENTER,
      openNetwork: K.N,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    this.banner = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, '', {
        fontFamily: FONT_STACK,
        fontSize: '40px',
        color: '#eef2ff',
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.rematchHint = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 12, tr('result.rematch', this.language), {
        fontFamily: FONT_STACK,
        fontSize: '18px',
        color: '#69ffa8',
      })
      .setOrigin(0.5)
      .setVisible(false);

    // The score against the limit, so a player can see how close the match is to ending — without it the kill
    // limit exists in the rules and nowhere a player can read it.
    this.scoreText = this.add
      .text(24, GAME_HEIGHT - 66, '', {
        fontFamily: FONT_STACK,
        fontSize: '16px',
        color: '#9aa7d4',
      })
      .setOrigin(0, 0);

    this.statusText = this.add
      .text(GAME_WIDTH - 24, GAME_HEIGHT - 40, '', {
        fontFamily: FONT_STACK,
        fontSize: '14px',
        color: '#9aa7d4',
      })
      .setOrigin(1, 0);

    // Read-only observation surface for the browser probe, mirroring ringout's. `snapshot` is here because a
    // production bundle has no Phaser global, so a probe cannot reach the renderer — and reading the WebGL
    // canvas directly returns blank without preserveDrawingBuffer.
    (window as unknown as { __GRIDFALL__?: unknown }).__GRIDFALL__ = {
      peek: () => this.world(),
      tick: () => (this.net ? this.net.tick : this.session!.stats().tick),
      hash: () => hashGridWorld(this.world()),
      role: () => this.role,
      networked: () => this.net !== undefined,
      columns: () => castView(this.eye(), COLUMNS),
      /**
       * The real transport, exposed for verification only.
       *
       * Node has no RTCPeerConnection, so the unit tests can cover the connection CODES and nothing else. The only way
       * to prove a genuine DTLS/SCTP handshake and a genuine data channel is to drive two peers in a real browser —
       * which needs the module reachable from the page, and this is the handle that already exists for exactly this
       * kind of measurement.
       */
      rtc: {
        createOffer: (opts?: RtcOptions) => createOffer<FpsInput>(opts),
        createAnswer: (code: string, opts?: RtcOptions) => createAnswer<FpsInput>(code, opts),
        // Asserts the mission property rather than trusting the constructor call site: an empty list means no STUN,
        // no TURN, and so no third-party request per match.
        iceServersUsed: () => [] as string[],
      },
      /**
       * Hide the interface, keeping the world.
       *
       * For the landing-page thumbnail, which shows gameplay and not the interface on all five older games. It
       * lives here rather than in the capture script because the capture script's shared strip-UI routine walks
       * the display list looking for sprites by size, and neither of these games HAS sprites -- both draw their
       * whole world into one Graphics object, so a size rule would either keep everything or hide everything.
       * Naming the interface explicitly is the only rule that can tell them apart, and only the scene knows the
       * names.
       */
      hideUi: () => {
        const ui = [this.hud, this.statusText, this.banner, this.scoreText, this.rematchHint];
        for (const object of ui) object.setVisible(false);
        return ui.length;
      },
      snapshot: () =>
        new Promise<string | null>((resolve) => {
          this.game.renderer.snapshot((image) => {
            const source = image as HTMLImageElement;
            resolve(source && typeof source.src === 'string' ? source.src : null);
          });
        }),
    };
  }

  /**
   * Try the tab-to-tab transport, and carry on locally if nothing answers.
   *
   * Deliberately non-blocking: a player who opened one tab wants the shared-keyboard game immediately, so the
   * scene starts on a local session and swaps to a networked one only if a peer actually appears. Waiting for a
   * peer that will never arrive would make the single-tab case feel broken.
   */
  shutdown(): void {
    // Closing the channel matters: a tab that navigates away without it leaves a listener that answers the next
    // tab's handshake, so a fresh pair would negotiate against a ghost.
    this.transport?.close();
    this.transport = undefined;
  }

  /**
   * Offer the real-network path on N.
   *
   * Created lazily on first use rather than at scene start: it appends DOM, and a player who never plays over the
   * network should not carry an overlay they never open.
   */
  private openConnectPanel(): void {
    if (this.net) return; // Already in a networked match; a second link would fight the first.
    if (!this.connectPanel) {
      this.connectPanel = createConnectPanel({
        language: this.language,
        onConnected: (link, participant) => {
          this.role = participant;
          this.startNetworked(link, participant);
        },
      });
    }
    this.connectPanel.open();
  }

  private connectIfAnotherTabIsOpen(): void {
    if (!tabTransportAvailable()) return;
    const transport = openTabTransport();
    this.transport = transport;
    void transport.role.then((role) => {
      this.role = role;
    });
    // Gated on a CONFIRMED peer, not on the role settling: p1's role resolves on a timeout, which is also what
    // happens when it is alone, so upgrading there would put a lone tab into a networked match against nobody.
    transport.onPeer(() => {
      void transport.role.then((role) => this.startNetworked(transport.link, role));
    });
  }

  /**
   * Start a networked session on any link.
   *
   * Takes a PeerLink rather than a TabTransport, because the link is the only thing this needed from it and there are
   * now two transports: the BroadcastChannel between contexts of one browser, and an RTCDataChannel between two
   * machines on one network. Everything below is identical for both — which is the payoff of the netcode never having
   * held a socket.
   */
  private startNetworked(link: PeerLink<FpsInput>, role: Role): void {
    if (this.net) return;
    this.session = undefined;
    this.net = new NetSession<GridWorld, FpsInput>({
      sim: createGridSimulation(['p1', 'p2']),
      participants: ['p1', 'p2'],
      localParticipant: role,
      link,
      hashState: hashGridWorld,
      checksumInterval: 60,
      maxRollbackTicks: 240,
      onDesync: (report) => {
        // Reported, never repaired. Repair would mean shipping world state, which abandons input-only and hands
        // one tab authority over the other; showing it turns a silent disagreement into something a player can
        // see and restart out of.
        this.desyncAt = report.tick;
      },
    });
  }

  /** The world, from whichever driver is active. */
  private world(): GridWorld {
    return this.net ? this.net.peek() : this.session!.peek();
  }

  /** The player this tab looks through. */
  private eye() {
    const world = this.world();
    return world.players[this.role === 'p1' ? 0 : 1];
  }

  private readInput(prefix: '' | 'p2'): FpsInput {
    const key = (name: string) =>
      prefix === '' ? name : `p2${name[0].toUpperCase()}${name.slice(1)}`;
    const down = (name: string) => this.keys[key(name)]?.isDown ?? false;
    return {
      ...NEUTRAL_FPS_INPUT,
      forward: down('forward'),
      back: down('back'),
      left: down('strafeLeft'),
      right: down('strafeRight'),
      turnLeft: down('turnLeft') || (prefix === '' && down('turnLeftAlt')),
      turnRight: down('turnRight') || (prefix === '' && down('turnRightAlt')),
      fire: down('fire'),
    };
  }

  update(_time: number, deltaMs: number): void {
    // JustDown rather than isDown: a held key would reopen the panel every frame.
    if (Phaser.Input.Keyboard.JustDown(this.keys.openNetwork)) this.openConnectPanel();
    // Clamped so a tab backgrounded for a minute does not try to simulate a minute in one frame and hang the
    // page. Dropping that time is the honest trade; nobody was watching.
    this.carry += Math.min(deltaMs / 1000, 0.25);
    while (this.carry >= 1 / 60) {
      this.carry -= 1 / 60;
      if (this.net) {
        /**
         * Networked: send only OUR input, and read it from the PRIMARY keys whatever role we hold.
         *
         * The p2 key set (I/J/K/L/U/O) exists so two people can share one keyboard without their hands colliding.
         * Over the network there is no collision to avoid — each player is alone at their own device — so binding the
         * guest to the secondary set would mean the two players use different controls for the same game, and the
         * guest gets the awkward half. Found by driving two real browser windows: pressing W moved the host and did
         * nothing at all for the guest.
         */
        this.net.advance(this.readInput(''));
      } else {
        // Local: two players on one keyboard, both inputs known, so nothing is ever predicted.
        const session = this.session!;
        const at = session.stats().tick;
        session.setLocalInput('p1', this.readInput(''));
        session.setLocalInput('p2', this.readInput('p2'));
        session.advanceTo(at + 1);
      }
    }
    this.draw();
  }

  /**
   * Fire sound cues by OBSERVING state transitions, never from inside the step.
   *
   * This distinction is the whole design. A rollback replays ticks — that is its job — so a cue emitted inside
   * `stepGrid` would sound again every time a tick was re-simulated, and a laggy connection would turn one shot into
   * a stutter of shots. Observing the drawn state instead means a cue fires once per visible change.
   *
   * Every comparison is DIRECTIONAL for the same reason: a rewind makes the observed state move backwards, so hp
   * rising or a shot list shrinking must fire nothing. Only forward transitions are audible.
   */
  private emitCues(world: GridWorld): void {
    const previous = this.lastSeen;
    this.lastSeen = {
      shotIds: new Set(world.shots.map((shot) => shot.id)),
      hp: world.players.map((player) => player.hp),
      kills: world.players.map((player) => player.kills),
      alive: world.players.map((player) => player.respawnAt === null),
      decided: world.outcome.kind !== 'ongoing',
    };
    if (!previous) return;

    // A shot id that was not in the previous frame is a new shot. Ids include the tick, so they are never reused.
    for (const shot of world.shots) {
      if (!previous.shotIds.has(shot.id)) {
        this.cues.play('shoot');
        break; // One cue per frame however many were fired; several at once would just clip.
      }
    }

    world.players.forEach((player, index) => {
      if (player.hp < (previous.hp[index] ?? player.hp)) this.cues.play('hit');
      const wasAlive = previous.alive[index] ?? true;
      const isAlive = player.respawnAt === null;
      if (wasAlive && !isAlive) this.cues.play('death');
      if (!wasAlive && isAlive) this.cues.play('respawn');
    });

    if (!previous.decided && world.outcome.kind !== 'ongoing') this.cues.play('matchWin');
  }

  private draw(): void {
    const world = this.world();
    this.emitCues(world);
    const eye = this.eye();
    const g = this.view;
    g.clear();

    const horizon = GAME_HEIGHT / 2;

    // Floor and ceiling as two flat bands. A gradient would cost a rectangle per scanline for an effect that
    // reads as noise at this palette's contrast.
    g.fillStyle(PALETTE.ceiling, 1);
    g.fillRect(0, 0, GAME_WIDTH, horizon);
    g.fillStyle(PALETTE.floor, 1);
    g.fillRect(0, horizon, GAME_WIDTH, GAME_HEIGHT - horizon);

    const columns = castView(eye, COLUMNS);
    columns.forEach((column, index) => {
      if (column.missed) return;
      const height = Math.min(GAME_HEIGHT * 6, wallHeight(column.distance, PROJECTION));
      const top = horizon - height / 2;
      // Opaque, with the shade applied to the COLOUR. Carrying it in alpha instead makes the wall translucent
      // and the floor-ceiling boundary shows through it as a bright seam at the horizon — visible in the first
      // captured frame, invisible to every assertion.
      g.fillStyle(shadeColor(PALETTE.wall, shade(column.distance, column.side)), 1);
      g.fillRect(index * COLUMN_WIDTH, top, COLUMN_WIDTH + 1, height);
    });

    this.drawOpponent(g, world);
    this.drawHud(world);
  }

  /**
   * Draw the other player as a billboard column, depth-tested against the wall behind them.
   *
   * A sprite would need an image; a rectangle scaled by distance carries the same information — where they are
   * and how far — with no asset at all. The wall test matters because without it an opponent behind a corner
   * is drawn through it, which in a shooter is not a cosmetic bug but a wallhack.
   */
  private drawOpponent(g: Phaser.GameObjects.Graphics, world: GridWorld): void {
    const eye = this.eye();
    const other = world.players[this.role === 'p1' ? 1 : 0];
    if (!isAlive(other)) return;

    const dx = other.x - eye.x;
    const dy = other.y - eye.y;
    const dirX = Math.cos(eye.angle);
    const dirY = Math.sin(eye.angle);
    // Distance along the view axis. Behind the eye means not drawn at all.
    const depth = dx * dirX + dy * dirY;
    if (depth <= 0.1) return;
    // Lateral offset, in the same units, converted to a column.
    const lateral = dx * -dirY + dy * dirX;
    const plane = Math.tan(Math.PI / 3 / 2);
    const screenX = GAME_WIDTH / 2 + (lateral / (depth * plane)) * (GAME_WIDTH / 2);
    if (screenX < -60 || screenX > GAME_WIDTH + 60) return;

    const columnIndex = Math.max(0, Math.min(COLUMNS - 1, Math.floor(screenX / COLUMN_WIDTH)));
    const wall = castView(eye, COLUMNS)[columnIndex];
    if (!wall.missed && wall.distance < depth) return;

    const height = wallHeight(depth, PROJECTION) * 0.62;
    const width = Math.max(3, height * 0.42);
    g.fillStyle(shadeColor(PALETTE.otherPlayer, Math.max(0.3, shade(depth, 'x'))), 1);
    g.fillRect(screenX - width / 2, GAME_HEIGHT / 2 - height / 2, width, height);
  }

  /**
   * Show the result once and arm a rematch.
   *
   * Guarded by a flag because drawHud runs every frame: without it the banner would be re-set and the rematch
   * re-armed sixty times a second, and the keypress handler would stack up sixty deep.
   */
  private showResult(world: GridWorld): void {
    if (world.outcome.kind === 'ongoing') {
      this.banner.setVisible(false);
      this.rematchHint.setVisible(false);
      return;
    }
    if (this.resultShown) return;
    this.resultShown = true;

    const key =
      world.outcome.kind === 'draw'
        ? 'result.draw'
        : world.outcome.winnerId === this.role
          ? 'result.win'
          : 'result.lose';
    const winner =
      world.outcome.kind === 'draw'
        ? ''
        : tr(world.outcome.winnerId === 'p1' ? 'net.roleHost' : 'net.roleGuest', this.language);
    this.banner.setText(tr(key, this.language, { winner })).setVisible(true);
    this.rematchHint.setVisible(true);

    // A short delay before arming, because the match ends on a frame where a player was still holding fire, and a
    // rematch triggered by that keypress would skip the result screen entirely.
    this.time.delayedCall(700, () => {
      const again = () => this.scene.restart();
      this.input.keyboard?.once('keydown', again);
      this.input.once('pointerdown', again);
    });
  }

  private drawHud(_world: GridWorld): void {
    const g = this.hud;
    g.clear();
    const me = this.eye();

    // Crosshair. Two short strokes rather than a dot, so it stays visible against both the floor band and a
    // brightly lit near wall.
    g.lineStyle(2, PALETTE.crosshair, 0.85);
    g.beginPath();
    g.moveTo(GAME_WIDTH / 2 - 9, GAME_HEIGHT / 2);
    g.lineTo(GAME_WIDTH / 2 + 9, GAME_HEIGHT / 2);
    g.moveTo(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 9);
    g.lineTo(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 9);
    g.strokePath();

    const barWidth = 260;
    const fraction = Math.max(0, Math.min(1, me.hp / RULES.maxHp));
    g.fillStyle(PALETTE.hpTrack, 1);
    g.fillRect(24, GAME_HEIGHT - 40, barWidth, 14);
    g.fillStyle(fraction <= 0.25 ? PALETTE.hpLow : PALETTE.hpFill, 1);
    g.fillRect(24, GAME_HEIGHT - 40, barWidth * fraction, 14);

    const world = this.world();
    this.scoreText.setText(
      tr('hud.kills', this.language, { count: this.eye().kills, limit: RULES.killLimit }),
    );
    this.showResult(world);

    this.statusText.setText(
      this.desyncAt !== null
        ? tr('net.desync', this.language, { tick: this.desyncAt })
        : this.net
          ? tr('net.connected', this.language, {
              role: tr(this.role === 'p1' ? 'net.roleHost' : 'net.roleGuest', this.language),
            })
          : tr('net.local', this.language),
    );
  }
}
