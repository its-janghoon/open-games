import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH } from '../config/GameConfig';

/**
 * Placeholder first scene. Replace this with the real boot / preload / title
 * flow; it exists so a freshly scaffolded game builds and runs immediately.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Gridfall', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '36px',
        color: '#eef2ff',
      })
      .setOrigin(0.5);

    this.add
      .text(
        GAME_WIDTH / 2,
        GAME_HEIGHT / 2 + 52,
        '아무 키나 눌러 시작  ·  press any key\n\nW A S D 이동 · \u2190 \u2192 또는 Q E 회전 · Space 발사\nmove · turn · fire',
        {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '15px',
          color: '#9aa7d4',
          align: 'center',
          lineSpacing: 6,
        },
      )
      .setOrigin(0.5);

    const start = () => this.scene.start('Fps');
    this.input.keyboard?.once('keydown', start);
    this.input.once('pointerdown', start);
  }
}
