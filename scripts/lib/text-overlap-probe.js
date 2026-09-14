(async () => {
  const g = window.__GAME__;
  if (!g) return { error: 'no __GAME__' };
  const target = window.__OVERLAP_SCENE__ || 'TownScene';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (!g.scene.getScenes(true).some((s) => s.scene.key === target)) {
    try {
      for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
      g.scene.start(target);
    } catch (e) {
      return { error: 'could not start ' + target + ': ' + e.message };
    }
  }
  await sleep(3500);

  // EFFECTIVE visibility: an object inside a hidden or transparent container is not
  // on screen even though its own .visible is true. Counting without this reported
  // 324 overlapping pairs in one scene, nearly all of them text belonging to closed
  // panels that are still in the display list.
  const shown = (o) => {
    let n = o;
    while (n) {
      if (n.visible === false) return false;
      if (typeof n.alpha === 'number' && n.alpha <= 0.01) return false;
      n = n.parentContainer;
    }
    return true;
  };

  const out = [];
  for (const scene of g.scene.getScenes(true)) {
    const cam = scene.cameras && scene.cameras.main;
    const view = cam ? { w: cam.width, h: cam.height } : { w: 960, h: 540 };
    const texts = [];
    const collect = (list) => {
      for (const o of list) {
        if (o.type === 'Container' && o.list) { collect(o.list); continue; }
        if (o.type !== 'Text' && o.type !== 'BitmapText') continue;
        if (!shown(o)) continue;
        const t = (o.text || '').trim();
        if (!t) continue;
        let b;
        try { b = o.getBounds(); } catch (e) { continue; }
        if (!b || b.width <= 0 || b.height <= 0) continue;
        // Offscreen text cannot collide with anything a player sees.
        if (b.x + b.width < 0 || b.y + b.height < 0 || b.x > view.w || b.y > view.h) continue;
        texts.push({ t: t.slice(0, 26), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), d: o.depth ?? 0 });
      }
    };
    collect(scene.children.list);

    const pairs = [];
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        const a = texts[i], b = texts[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox <= 1 || oy <= 1) continue;
        const area = ox * oy;
        const smaller = Math.min(a.w * a.h, b.w * b.h);
        pairs.push({
          a: a.t, b: b.t,
          frac: Math.round((area / smaller) * 100) / 100,
          at: [a.x, a.y], bt: [b.x, b.y], da: a.d, db: b.d, sameDepth: a.d === b.d,
        });
      }
    }
    pairs.sort((p, q) => q.frac - p.frac);
    out.push({ scene: scene.scene.key, texts: texts.length, overlapping: pairs.length, worst: pairs.slice(0, 8) });
  }
  return out;
})()
