import Phaser from 'phaser';
import { RollbackSession } from '@open-games/shared';

import { GAME_HEIGHT, GAME_WIDTH } from '../config/GameConfig';
import {
  cameraFor,
  FLOOR_SCREEN_Y,
  project,
  type CameraFrame,
  HP_BAR,
  hpBarRect,
  hpFillRect,
  LIMB_WIDTH,
  PALETTE,
  ringEdges,
  TORSO_WIDTH,
} from '../config/View';
import { createFightSimulation } from '../game/fightSimulation';
import {
  hitBox,
  NEUTRAL_INPUT,
  RING,
  TICK_SECONDS,
  type FightInput,
  type FightState,
} from '../game/fightState';
import { poseFor, segments, type Pose } from '../game/pose';

/**
 * The fight, drawn from geometry alone.
 *
 * No image assets, no sprite sheets, no atlas — every pixel is a line, a circle or a rectangle. That
 * is the aesthetic premise, and it is also why ringout's whole download is the Phaser engine and
 * nothing else: 357 KB cold, against champs' 1.65 MB. On the metered connection this project is aimed
 * at, "the art is code" is a transfer-budget decision as much as a style.
 *
 * The scene reads state and draws. It contains no rule: every decision about what a fighter can do
 * lives in stepFight, which is why that file is testable without Phaser and this one needs almost no
 * tests at all. That division is the lesson from champs' BattleScene, where the world advanced inside
 * the scene and extracting it later took six commits.
 */
export class FightScene extends Phaser.Scene {
  private session!: RollbackSession<FightState, FightInput>;
  private graphics!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private banner!: Phaser.GameObjects.Text;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  /**
   * Left-over real time not yet converted into ticks.
   *
   * The simulation MUST advance in fixed steps — that is what makes it reproducible — but a browser
   * delivers frames at whatever rate it manages. So real time accumulates here and is spent in whole
   * ticks, and a frame that arrives late runs several. Stepping the simulation by the frame delta
   * instead would tie the game's behaviour to the machine's frame rate, which is the one thing a
   * rollback cannot tolerate.
   */
  private carry = 0;

  constructor() {
    super('Fight');
  }

  create(): void {
    this.session = new RollbackSession(createFightSimulation(['p1', 'p2']), {
      participants: ['p1', 'p2'],
      maxRollbackTicks: 180,
    });

    this.cameras.main.setBackgroundColor(PALETTE.background);
    this.graphics = this.add.graphics();
    // The HUD is pinned to the screen, not to the world. A zooming camera would slide and rescale the
    // hp bars every time the fighters moved, which makes the one thing a player checks under pressure
    // the least stable thing on screen.
    this.hud = this.add.graphics().setScrollFactor(0);

    this.banner = this.add
      .text(GAME_WIDTH / 2, 150, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '40px',
        color: '#eef2ff',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);

    // Two players on one keyboard. Both hands get the same shape: three directions plus three
    // attacks, so neither side is a worse control scheme than the other.
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard!.addKeys({
      p1Left: K.A,
      p1Right: K.D,
      p1Up: K.W,
      p1Down: K.S,
      p1Jab: K.F,
      p1Kick: K.G,
      p1Slam: K.H,
      p2Left: K.LEFT,
      p2Right: K.RIGHT,
      p2Up: K.UP,
      p2Down: K.DOWN,
      p2Jab: K.J,
      p2Kick: K.K,
      p2Slam: K.L,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    // Exposed for the browser probe, the way the other games expose their state. Read-only from
    // outside: nothing here lets a caller change the fight, only observe it.
    //
    // `snapshot` is here because a production bundle has no `Phaser` global, so a probe cannot reach
    // the renderer to capture a frame — and capturing the canvas directly returns blank on WebGL
    // without preserveDrawingBuffer. Going through the renderer's own snapshot avoids both.
    (window as unknown as { __RINGOUT__?: unknown }).__RINGOUT__ = {
      peek: () => this.session.peek(),
      poseOf: (index: number) => {
        const state = this.session.peek();
        return poseFor(state.fighters[index], state.tick);
      },
      tick: () => this.session.stats().tick,
      snapshot: () =>
        new Promise<string | null>((resolve) => {
          this.game.renderer.snapshot((image) => {
            const source = image as HTMLImageElement;
            resolve(source && typeof source.src === 'string' ? source.src : null);
          });
        }),
    };
  }

  private readInput(prefix: 'p1' | 'p2'): FightInput {
    const down = (name: string) => this.keys[`${prefix}${name}`]?.isDown ?? false;
    return {
      ...NEUTRAL_INPUT,
      left: down('Left'),
      right: down('Right'),
      up: down('Up'),
      down: down('Down'),
      jab: down('Jab'),
      kick: down('Kick'),
      slam: down('Slam'),
    };
  }

  update(_time: number, deltaMs: number): void {
    // Clamped so a tab that was backgrounded for a minute does not try to simulate a minute of fight
    // in one frame and freeze the page. Dropping that time is the honest trade: the alternative is a
    // hang, and nobody was watching anyway.
    this.carry += Math.min(deltaMs / 1000, 0.25);
    while (this.carry >= TICK_SECONDS) {
      this.carry -= TICK_SECONDS;
      const at = this.session.stats().tick;
      this.session.setLocalInput('p1', this.readInput('p1'));
      this.session.setLocalInput('p2', this.readInput('p2'));
      this.session.advanceTo(at + 1);
    }
    this.draw();
  }

  private draw(): void {
    const state = this.session.peek();
    const g = this.graphics;
    g.clear();

    // Frame the fight, then project everything through that frame. Phaser's camera is deliberately
    // left alone: zooming it shrank the visible band to 169 px and pushed the floor off screen.
    const frame = cameraFor(state.fighters.map((fighter) => fighter.x));
    const to = (x: number, y: number) => project(x, y, frame);

    const edges = ringEdges(frame);
    g.lineStyle(3, PALETTE.floor, 1);
    g.beginPath();
    g.moveTo(edges.left, FLOOR_SCREEN_Y);
    g.lineTo(edges.right, FLOOR_SCREEN_Y);
    g.strokePath();

    // The edges are drawn as full-height posts because leaving the ring loses the match: a boundary
    // that decides the fight has to be impossible to miss.
    g.lineStyle(4, PALETTE.edge, 0.85);
    for (const x of [edges.left, edges.right]) {
      g.beginPath();
      g.moveTo(x, FLOOR_SCREEN_Y);
      g.lineTo(x, FLOOR_SCREEN_Y - 210 * frame.zoom);
      g.strokePath();
    }

    state.fighters.forEach((fighter, index) => {
      const colour = index === 0 ? PALETTE.fighterLeft : PALETTE.fighterRight;
      this.drawFighter(g, poseFor(fighter, state.tick), colour, frame);
      const box = hitBox(fighter, state.tick);
      if (box) {
        // The live hitbox is drawn. In a fighter the box IS the mechanic, and hiding it means the
        // player has to infer their own range from damage they took — a much worse teacher.
        const topLeft = to(box.x - box.halfWidth, box.y + box.halfHeight);
        g.lineStyle(2, PALETTE.hitbox, 0.9);
        g.strokeRect(topLeft.x, topLeft.y, box.halfWidth * 2 * frame.zoom, box.halfHeight * 2 * frame.zoom);
      }
    });

    this.drawHud(state);
  }

  private drawFighter(
    g: Phaser.GameObjects.Graphics,
    pose: Pose,
    colour: number,
    frame: CameraFrame,
  ): void {
    const strikingSegment =
      pose.striking === 'armFront' ? 3 : pose.striking === 'legFront' ? 7 : -1;

    segments(pose).forEach(([from, to], index) => {
      const a = project(from.x, from.y, frame);
      const b = project(to.x, to.y, frame);
      const torso = index <= 1;
      const isStriking = index === strikingSegment;
      const width = (torso ? TORSO_WIDTH : LIMB_WIDTH) * frame.zoom;
      g.lineStyle(
        width,
        isStriking ? PALETTE.strikingLimb : colour,
        1,
      );
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.strokePath();
      // Round the joints by hand. Phaser's Graphics has no line cap, so a chain of plain strokes
      // shows a notch at every bend; a dot at each end closes it for the price of one circle.
      g.fillStyle(isStriking ? PALETTE.strikingLimb : colour, 1);
      g.fillCircle(a.x, a.y, width / 2);
      g.fillCircle(b.x, b.y, width / 2);
    });

    const head = project(pose.head.x, pose.head.y, frame);
    g.fillStyle(colour, 1);
    g.fillCircle(head.x, head.y, pose.headRadius * frame.zoom);
  }

  private drawHud(state: FightState): void {
    const g = this.hud;
    g.clear();
    (['left', 'right'] as const).forEach((side, index) => {
      const track = hpBarRect(side);
      g.fillStyle(PALETTE.hpTrack, 1);
      g.fillRect(track.x, track.y, track.width, track.height);
      const fill = hpFillRect(side, state.fighters[index].hp);
      g.fillStyle(fill.color, 1);
      g.fillRect(fill.x, fill.y, fill.width, fill.height);
    });

    if (state.outcome.kind === 'ongoing') {
      this.banner.setVisible(false);
      return;
    }
    const text =
      state.outcome.kind === 'draw'
        ? '무승부 / DRAW'
        : state.outcome.kind === 'ringout'
          ? `링아웃 / RING OUT — ${state.outcome.winner}`
          : `K.O. — ${state.outcome.winner}`;
    this.banner.setText(text).setVisible(true);
  }
}

/** Re-exported so the boot scene can size the world without importing the ring rules directly. */
export const RING_HALF_WIDTH = RING.halfWidth;
export const SCENE_SIZE = { width: GAME_WIDTH, height: GAME_HEIGHT };
export const FLOOR = { y: FLOOR_SCREEN_Y, hpBarHeight: HP_BAR.height };
