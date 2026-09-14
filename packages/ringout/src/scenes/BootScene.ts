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
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 44, 'Scaffolded from packages/_template', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        color: '#9aa7d4',
      })
      .setOrigin(0.5);
  }
}
