import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH } from '../config/GameConfig';
import { resolveLanguage, tr } from '../i18n/strings';

/**
 * Placeholder first scene. Replace this with the real boot / preload / title
 * flow; it exists so a freshly scaffolded game builds and runs immediately.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const language = resolveLanguage();
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 70, tr('brand.name', language), {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '50px',
        color: '#eef2ff',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 22, tr('title.tagline', language), {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        color: '#9aa7d4',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 22, tr('title.start', language), {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '19px',
        color: '#69ffa8',
      })
      .setOrigin(0.5);

    // Every string from the table, including the control diagrams. The previous version concatenated Korean and
    // English inline, which reads as neither language and cannot be checked for completeness.
    const lines = [
      tr('title.p1Controls', language),
      tr('title.p2Controls', language),
      '',
      tr('title.sharedNote', language),
    ].join('\n');
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 96, lines, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#6f7ba8',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5);

    const start = () => this.scene.start('Fps');
    this.input.keyboard?.once('keydown', start);
    this.input.once('pointerdown', start);
  }
}
