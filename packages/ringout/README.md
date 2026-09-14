# Ringout

> **This directory is a template, not a game.** `packages/_template` is excluded
> from the root `workspaces` glob, so it is never installed, built, or tested.
> Copy it with `npm run new-game` (see below) rather than editing it in place.

An original browser game built with **Vite + TypeScript + Phaser 3.80**.

## Scaffolding a new game from this template

From the repo root:

```bash
npm run new-game -- --slug foo --title "Foo Quest"
npm install
npm run dev -w packages/foo
```

`new-game` copies this directory to `packages/<slug>` and substitutes the
`ringout` and `Ringout` placeholders in every file. Everything else in the
repo - the landing page, the README tables, the Pages workflow - picks the game
up automatically from its `game.json`.

To scaffold by hand instead: copy this directory to `packages/<slug>`, then
replace `ringout` and `Ringout` throughout (`package.json`, `game.json`,
`index.html`, `vite.config.ts`, `src/`, this README).

## What you get

| Path | Purpose |
| --- | --- |
| `index.html` | Vite entry document with a full-viewport `#game` mount point |
| `src/main.ts` | Phaser game bootstrap (FIT scaling, centred, pixel art on) |
| `src/scenes/BootScene.ts` | Placeholder first scene - replace with the real flow |
| `src/config/GameConfig.ts` | Tuning values plus a pure helper worth unit testing |
| `src/config/GameConfig.test.ts` | Example Vitest spec for that helper |
| `vite.config.ts` | Production base `/open-games/<slug>/`, dev base `/`, Phaser vendor chunk |
| `vitest.config.ts` | Node-environment tests over `src/**/*.test.ts` |
| `tsconfig.json` | TypeScript strict, no emit |
| `game.json` | Metadata stub - fill this in before the game is listed |

## Checklist after scaffolding

1. Fill in `game.json`: `title`, `titleKo`, `genre`, `summary`, `summaryKo`.
   Leave `status` at `"wip"` until the game is playable, then set `"playable"`.
2. Confirm `vite.config.ts` has the production base `/open-games/<slug>/`.
3. Run `npm install`, then `npm run typecheck`, `npm run test`, `npm run build`
   from the repo root.
4. Write this README to describe the actual game.

See the repo-root [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for the full
checklist and the original-naming rules that every game here has to follow.

## Scripts

```bash
npm run dev        # Vite dev server with hot reload
npm run build      # type-check + production build into dist/
npm run typecheck  # tsc --noEmit
npm run test       # vitest run
```

## License

Apache-2.0, under the repo-root [`LICENSE`](../../LICENSE).
