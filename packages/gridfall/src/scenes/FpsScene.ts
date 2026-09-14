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
  ceiling: 0x080b14,
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
  private session!: RollbackSession<GridWorld, FpsInput>;
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
    this.session = new RollbackSession(createGridSimulation(['p1', 'p2']), {
      participants: ['p1', 'p2'],
      maxRollbackTicks: 240,
    });

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
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    // Read-only observation surface for the browser probe, mirroring ringout's. `snapshot` is here because a
    // production bundle has no Phaser global, so a probe cannot reach the renderer — and reading the WebGL
    // canvas directly returns blank without preserveDrawingBuffer.
    (window as unknown as { __GRIDFALL__?: unknown }).__GRIDFALL__ = {
      peek: () => this.session.peek(),
      tick: () => this.session.stats().tick,
      columns: () => {
        const world = this.session.peek();
        return castView(world.players[0], COLUMNS);
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

  private readInput(): FpsInput {
    const down = (name: string) => this.keys[name]?.isDown ?? false;
    return {
      ...NEUTRAL_FPS_INPUT,
      forward: down('forward'),
      back: down('back'),
      left: down('strafeLeft'),
      right: down('strafeRight'),
      turnLeft: down('turnLeft') || down('turnLeftAlt'),
      turnRight: down('turnRight') || down('turnRightAlt'),
      fire: down('fire'),
    };
  }

  update(_time: number, deltaMs: number): void {
    // Clamped so a tab backgrounded for a minute does not try to simulate a minute in one frame and hang the
    // page. Dropping that time is the honest trade; nobody was watching.
    this.carry += Math.min(deltaMs / 1000, 0.25);
    while (this.carry >= 1 / 60) {
      this.carry -= 1 / 60;
      const at = this.session.stats().tick;
      const input = this.readInput();
      this.session.setLocalInput('p1', input);
      // The second player is idle until the network slice lands. Stated rather than hidden: this is a
      // single-player view of a two-player world, not a bot.
      this.session.setLocalInput('p2', NEUTRAL_FPS_INPUT);
      this.session.advanceTo(at + 1);
    }
    this.draw();
  }

  private draw(): void {
    const world = this.session.peek();
    const eye = world.players[0];
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
    const eye = world.players[0];
    const other = world.players[1];
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

  private drawHud(world: GridWorld): void {
    const g = this.hud;
    g.clear();
    const me = world.players[0];

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
  }
}
