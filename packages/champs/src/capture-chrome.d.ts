/**
 * Types for the maintainer thumbnail tool's capture library.
 *
 * scripts/ is plain ESM JavaScript - it runs under node with no build step, on
 * purpose, because it is not part of the shipped game. captureRecipe.test.tsx
 * imports it anyway so champs' own suite guards the recipe that describes champs,
 * and a TS file importing untyped .mjs needs this declaration to typecheck.
 *
 * Deliberately loose: the recipe shape varies per game (some carry `depthFrom`,
 * some `crop`, only champs carries `nav` and `frame`), so pinning a strict type
 * here would have to be widened for every new recipe. The test narrows what it
 * uses at the point of use instead.
 */
declare module '*/scripts/lib/capture-chrome.mjs' {
  export const CAPTURE_RECIPES: Record<string, Record<string, unknown>>;
  export const STRIP_UI_JS: string;
  export const FRAME_CAMERA_JS: string;
  export const DOM_CHROME_JS: string;
}
