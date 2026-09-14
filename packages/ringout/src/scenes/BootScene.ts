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
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Ringout', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '36px',
        color: '#eef2ff',
      })
      .setOrigin(0.5);

    this.add
      .text(
        GAME_WIDTH / 2,
        GAME_HEIGHT / 2 + 44,
        '아무 키나 눌러 시작  ·  press any key\nP1  WASD + F G H        P2  \u2190\u2191\u2192\u2193 + J K L',
        {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '16px',
          color: '#9aa7d4',
          align: 'center',
          lineSpacing: 8,
        },
      )
      .setOrigin(0.5);

    // Any key starts the fight. A title that needs a specific key is a title some players stare at.
    this.input.keyboard?.once('keydown', () => this.scene.start('Fight'));
    this.input.once('pointerdown', () => this.scene.start('Fight'));
  }
}
