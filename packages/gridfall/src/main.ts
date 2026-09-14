import Phaser from 'phaser';

import { BACKGROUND_COLOR, GAME_HEIGHT, GAME_WIDTH } from './config/GameConfig';
import { BootScene } from './scenes/BootScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: BACKGROUND_COLOR,
  // Do NOT set `pixelArt: true`. It forces `antialias: false`, i.e. NEAREST on
  // EVERY texture, and Phaser Text is NOT exempt (TextureSource reads its
  // default scaleMode from `game.config.antialias`). Oversized glyph textures
  // then get nearest-minified to their drawn size, which point-samples texel
  // rows away and shreds small text - Hangul worst of all. Scale smoothly here
  // and restore crisp pixel art PER-TEXTURE after load:
  //
  //   this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  //
  // See lastwar/wirework PreloadScene.applyPixelArtFiltering() for the pattern.
  render: { antialias: true, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene],
});
