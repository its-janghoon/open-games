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
  // champs boots to a React menu, so unlike the others it needs DRIVING before
  // there is a battle to photograph. `nav` is a list of DOM clicks, run by the
  // capture script rather than in-page so Playwright's own waiting applies.
  //
  // The selectors are deliberately structural, not textual: the capture context
  // runs in ko-KR and every label is translated, so matching on text would break
  // the moment a string changes. Two of them need explaining.
  //   - The standard-match button's `btn--primary` is CONDITIONAL on there being
  //     no Continue button, so it cannot be selected by that. The arrow span is
  //     unique to it, hence `:has()`.
  //   - Conquest, not midline. Midline would also start - its branch of
  //     handleLockIn returns before the unlock check - but conquest is the three
  //     lane battlefield the shipped thumbnail was framed on.
  champs: {
    scene: 'BattleScene',
    rule: 'text',
    settle: 2600,
    nav: [
      { click: 'button:has(.main-menu__play-arrow)', then: 400 },
      { click: '.mode-card--conquest', then: 400 },
      { click: '.champion-select__find-match', then: 2600 },
    ],
    // champs' chrome is React DOM, not Phaser objects, so no display-list rule
    // can reach it. It is also not addressable by a static selector I could
    // verify: the HUD only mounts once the scene reports ready, which needs a real
    // browser, and in the test environment `.battle-screen` has a single child. So
    // this is expressed as a rule computed from the canvas instead - keep the
    // canvas's own ancestor chain, hide everything sitting beside it - which holds
    // whatever the HUD's class names turn out to be.
    domKeepCanvasChain: '.battle-screen',
    // The battle camera opens at roughly 2.8 zoom on one corner. Fitting every
    // object gives about 0.975 - legible, but mostly empty dark map. Framing the
    // centroid of the SMALL objects (the fighters, not the lane geometry) at
    // fit * 1.85 is what produced the shipped image.
    frame: { maxSpritePx: 60, zoomScale: 1.85 },
  },
};

/**
 * Browser-side camera framing, applied after the UI strip. Separate from
 * STRIP_UI_JS because it moves the camera rather than hiding anything, and only
 * a game whose recipe carries `frame` needs it.
 */
export const FRAME_CAMERA_JS = `(async (recipe) => {
  const game = window.__GAME__;
  if (!game) return { error: 'no __GAME__ hook' };
  const scene = game.scene.getScene(recipe.scene);
  if (!scene) return { error: 'scene ' + recipe.scene + ' not found' };

  const cam = scene.cameras.main;
  const small = [];
  scene.children.list.forEach((o) => {
    if (!o.visible) return;
    const w = o.displayWidth ?? o.width ?? 0;
    const h = o.displayHeight ?? o.height ?? 0;
    if (w <= 0 || h <= 0) return;
    if (Math.max(w, h) <= recipe.frame.maxSpritePx) small.push(o);
  });
  if (small.length === 0) return { error: 'no small objects to frame' };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sx = 0, sy = 0;
  small.forEach((o) => {
    sx += o.x; sy += o.y;
    minX = Math.min(minX, o.x); maxX = Math.max(maxX, o.x);
    minY = Math.min(minY, o.y); maxY = Math.max(maxY, o.y);
  });
  const cx = sx / small.length, cy = sy / small.length;
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const fit = Math.min(cam.width / spanX, cam.height / spanY);
  const zoom = fit * recipe.frame.zoomScale;

  cam.setZoom(zoom);
  cam.centerOn(cx, cy);
  return { framed: small.length, zoom: Number(zoom.toFixed(3)), cx: Math.round(cx), cy: Math.round(cy) };
})`;

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
      } else if (recipe.rule === 'text') {
        // Keep the whole world and drop only canvas lettering. champs draws its
        // battlefield as many small objects with no depth split and no size
        // split, so both other rules erase the fight itself; what actually needs
        // removing is the floating text (damage numbers, names, timers).
        keep = o.type !== 'Text' && o.type !== 'BitmapText';
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

  // DOM chrome is swept by DOM_CHROME_JS, called separately by the capture
  // script: it needs no Phaser hook, so keeping it out of here makes it testable
  // in a plain jsdom environment.
  const dom = 0;

  await sleep(300);
  return { scene: recipe.scene, kept: first.kept, hid: first.hid + second.hid, siblings, a11y, dom };
})`;

/**
 * Hide React DOM chrome sitting beside the game canvas.
 *
 * Separate from STRIP_UI_JS on purpose: this touches only the DOM, so it can be
 * tested without a Phaser hook or a GPU - which matters, because the only way
 * this routine can fail badly is by hiding the canvas itself, and that is exactly
 * what a test can pin.
 *
 * It is a RULE rather than a selector list. champs' HUD only mounts once its
 * scene reports ready, so its real class names are not observable in a test
 * environment; keeping the canvas's ancestor chain and hiding whatever sits
 * beside that chain is correct whatever those names are.
 */
export const DOM_CHROME_JS = `((rootSelector) => {
  const root = document.querySelector(rootSelector);
  if (!root) return { error: 'root ' + rootSelector + ' not found' };
  const canvas = root.querySelector('canvas');
  if (!canvas) return { error: 'no canvas under ' + rootSelector };

  let hid = 0;
  let node = canvas;
  while (node && node !== root) {
    const parent = node.parentElement;
    if (!parent) break;
    for (const sib of Array.from(parent.children)) {
      if (sib !== node && sib.style && sib.style.display !== 'none') {
        sib.style.display = 'none';
        hid += 1;
      }
    }
    node = parent;
  }
  return { hid, canvasVisible: canvas.style.display !== 'none' };
})`;
