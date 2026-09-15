import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH } from '../config/GameConfig';
import { tr, type Language } from '../i18n/strings';
import { FONT_STACK } from '../config/fontStack';

/**
 * Title screen.
 *
 * Every visible string comes from the table — including the game's own name, so no scene hardcodes even
 * the title. The previous version had Korean and English concatenated inline, which reads as neither
 * language properly and cannot be checked for completeness.
 *
 * The language is resolved from the browser rather than asked for. A player who has to pick a language
 * before they can start has already been asked to do work in a language they may not read.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const language = resolveLanguage();

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, tr('brand.name', language), {
        fontFamily: FONT_STACK,
        fontSize: '52px',
        color: '#eef2ff',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 12, tr('title.tagline', language), {
        fontFamily: FONT_STACK,
        fontSize: '17px',
        color: '#9aa7d4',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 34, tr('title.start', language), {
        fontFamily: FONT_STACK,
        fontSize: '20px',
        color: '#69ffa8',
      })
      .setOrigin(0.5);

    const controls = [
      tr('title.controlsP1', language),
      tr('title.controlsP2', language),
      tr('title.controlsHint', language),
      tr('title.network', language),
    ].join('\n');
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 104, controls, {
        fontFamily: FONT_STACK,
        fontSize: '15px',
        color: '#6f7ba8',
        align: 'center',
        lineSpacing: 7,
      })
      .setOrigin(0.5);

    // Any key or a tap starts the fight. A title that waits for one specific key is a title some
    // players sit and stare at.
    const start = () => this.scene.start('Fight', { language });
    this.input.keyboard?.once('keydown', start);
    this.input.once('pointerdown', start);
  }
}

/**
 * Pick the UI language from the browser, defaulting to Korean.
 *
 * Korean-first is the project's position, so an unrecognised or missing preference lands on Korean
 * rather than on English. Nothing is persisted: whiteout's normalizeSettings and champs' migrateProfile
 * are both strict allowlists that silently drop unlisted fields on reload, and adding a stored language
 * to ringout would mean either touching those or building a store for one value that the browser already
 * answers correctly.
 */
export function resolveLanguage(): Language {
  const tag =
    typeof navigator !== 'undefined' && typeof navigator.language === 'string'
      ? navigator.language.toLowerCase()
      : '';
  return tag.startsWith('en') ? 'en' : 'ko';
}
