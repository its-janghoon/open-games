/**
 * @open-games/shared - the public surface of the cross-game utilities.
 *
 * Games may import either the barrel (`@open-games/shared`) or a subpath
 * (`@open-games/shared/responsive`, `/dpr`, `/phaserScale`, `/touch`,
 * `/locale`, `/viewport`). Everything is TypeScript SOURCE consumed by each game's Vite
 * build; there is no dist and no build step (see package.json), so the deploy
 * assemble step - which copies only the games' dist - is unaffected.
 */

export * from './responsive';
export * from './dpr';
export * from './phaserScale';
export * from './touch';
export * from './locale';
export * from './viewport';
export * from './rollback';
export * from './netcode';
export * from './cueSynth';
export * from './rtcTransport';
export * from './connectPanel';
