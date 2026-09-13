/**
 * Browser-side routine that strips a game's on-screen UI so a screenshot shows
 * the world instead of the interface.
 *
 * The exported string is evaluated inside the page (via `page.evaluate`), which
 * is why it lives here as source text rather than as a function: the capture
 * tool runs in Node, the routine has to run in the browser.
 *
 * Everything here was derived by probing each game's live display list, not by
 * reading its source, because the obvious rules turned out not to hold:
 *
 *   - Depth is NOT a universal UI marker. whiteout's TownScene puts building
 *     sprites and the top resource bar at the same depth 0, so a depth
 *     threshold erases the town or keeps the bar. lastwar's RunScene, by
 *     contrast, does separate cleanly (world below depth 90, HUD at 90+) and
 *     its world contains Containers, so the sprite rule would erase the gates.
 *     Hence two rules, chosen per game.
 *   - `setScrollFactor(0)` is useless as a marker here: three of these games
 *     never move the camera, so world and UI share the same scroll factor.
 *   - Hiding once is not enough. These games re-show their own chrome from the
 *     update loop - whiteout's "FREEZING!" warning and objective banner both
 *     came back - so the scene must be PAUSED between two hide passes.
 *   - Some chrome is not a Phaser object at all: the games render a DOM
 *     accessibility layer (`.canvas-a11y-button`, one per interactive object)
 *     over the canvas, and a focused one is visible.
 *   - Chrome can belong to a sibling scene that is still running underneath,
 *     so every other active scene is blanked too.
 */

/** Per-game capture recipe. A game absent from here is shot as-is. */
export const CAPTURE_RECIPES = {
  whiteout: { scene: 'TownScene', rule: 'sprites', minPx: 40, settle: 2200 },
  kingshot: { scene: 'TownScene', rule: 'sprites', minPx: 40, settle: 2200 },
  // RunScene ends on its own without input and hands off to ResultsScene, which
  // empties the display list, so it is frozen as soon as it has children. The
  // game is portrait; `crop` takes a 16:9 band centred at this fraction of the
  // height, where the gates and squad are, so the landing row has content.
  lastwar: { scene: 'RunScene', rule: 'depth', depthFrom: 90, settle: 400, crop: 0.72 },
};

export const STRIP_UI_JS = `(async (recipe) => {
  const g = window.__GAME__;
  if (!g) return { error: 'no __GAME__ hook; load the game with ?debug' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (!g.scene.getScenes(true).some((s) => s.scene.key === recipe.scene)) {
    g.scene.start(recipe.scene);
    await sleep(500);
  }
  for (const s of g.scene.getScenes(true)) {
    if (s.scene.key !== recipe.scene && /Tutorial|Onboard/i.test(s.scene.key)) {
      g.scene.stop(s.scene.key);
    }
  }

  let siblings = 0;
  for (const s of g.scene.getScenes(true)) {
    if (s.scene.key === recipe.scene) continue;
    for (const o of s.children.list) {
      if (o.visible && o.setVisible) { o.setVisible(false); siblings += 1; }
    }
    if (s.scene.pause) s.scene.pause();
  }

  const scene = g.scene.getScene(recipe.scene);
  if (!scene) return { error: 'scene not available: ' + recipe.scene };
  let waited = 0;
  while (scene.children.list.length === 0 && waited < 6000) { await sleep(200); waited += 200; }
  await sleep(recipe.settle || 500);
  if (scene.children.list.length === 0) return { error: 'scene drew nothing', waited };

  const WORLD = new Set(['TileSprite', 'Image', 'Sprite']);
  const pass = () => {
    let hid = 0, kept = 0;
    for (const o of scene.children.list) {
      let keep;
      if (recipe.rule === 'depth') {
        keep = !(typeof o.depth === 'number' && o.depth >= recipe.depthFrom);
      } else {
        let big = false;
        try {
          const b = o.getBounds && o.getBounds();
          big = !!b && Math.max(b.width, b.height) >= (recipe.minPx || 40);
        } catch (e) { big = false; }
        keep = WORLD.has(o.type) && big;
      }
      if (keep) { kept += 1; continue; }
      if (o.visible && o.setVisible) { o.setVisible(false); hid += 1; }
    }
    return { hid, kept };
  };

  const first = pass();
  if (scene.scene.pause) scene.scene.pause();
  await sleep(600);
  const second = pass();

  let a11y = 0;
  for (const el of document.querySelectorAll('.canvas-a11y-button')) {
    el.style.display = 'none';
    a11y += 1;
  }

  await sleep(300);
  return { scene: recipe.scene, kept: first.kept, hid: first.hid + second.hid, siblings, a11y };
})`;
