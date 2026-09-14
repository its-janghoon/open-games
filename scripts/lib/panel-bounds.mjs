/**
 * Static panel-bounds analysis.
 *
 * The town/menu screens in these games position every element with hand-written
 * absolute coordinates against the fixed design band. Nothing ties a panel's box
 * to the coordinates of the children placed inside it, so the two drift apart and
 * a button ends up hanging outside its own panel (kingshot's battle panel spans
 * y 65..475 and puts its close button at y=475, so half of it is outside).
 *
 * This finds those cases WITHOUT a browser by reading the source: for every
 * function that builds exactly one `Menu.panel(scene, x, y, w, h)`, each
 * `Menu.button(...)` created in the same function must fit inside that panel.
 *
 * SOUNDNESS: a button's real size is
 *     w = max(opts.width ?? labelW, labelW)      h = max(44, opts.height ?? labelH, labelH)
 * so the label can only make it BIGGER. We therefore model the smallest box the
 * button can possibly have (opts.width when given, and a height floor of 44).
 * Every violation reported is a violation of that lower bound, so it is real.
 * Anything whose coordinates do not resolve to numbers is reported as `skipped`,
 * never as a violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Button height floor from Menu.button: h = Math.max(44, ...). */
const MIN_BUTTON_H = 44;

/** Offset of the innermost `{` still open at `index`, identifying its block. */
function blockAt(body, index) {
  const stack = [];
  for (let i = 0; i < index && i < body.length; i += 1) {
    if (body[i] === '{') stack.push(i);
    else if (body[i] === '}') stack.pop();
  }
  return stack.length ? stack[stack.length - 1] : -1;
}

/** Evaluate a tiny arithmetic expression against a scope of known numbers. */
export function evalExpr(src, scope) {
  const text = String(src).trim();
  if (!text) return null;
  // Only digits, identifiers/dotted names, arithmetic and parens are allowed.
  if (!/^[\w.\s+\-*/()]+$/.test(text)) return null;
  const resolved = text.replace(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g, (name) => {
    if (Object.prototype.hasOwnProperty.call(scope, name)) return `(${scope[name]})`;
    return 'NaN';
  });
  if (resolved.includes('NaN')) return null;
  try {
    // eslint-disable-next-line no-new-func -- input is whitelisted to arithmetic above.
    const value = Function(`"use strict";return (${resolved});`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Split a call's argument list on top-level commas. */
export function splitArgs(text) {
  const args = [];
  let depth = 0;
  let current = '';
  let quote = null;
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; current += ch; continue; }
    if ('([{'.includes(ch)) depth += 1;
    if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) { args.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) args.push(current);
  return args.map((a) => a.trim());
}

/** Find `name(` call sites and return their balanced argument text + offset. */
export function findCalls(source, name) {
  const out = [];
  const needle = `${name}(`;
  let index = source.indexOf(needle);
  while (index !== -1) {
    let depth = 0;
    let i = index + needle.length - 1;
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push({ start: index, args: splitArgs(source.slice(index + needle.length, i)) });
    index = source.indexOf(needle, i + 1);
  }
  return out;
}

/** Brace-matched function bodies, keyed by their declared name. */
export function functionBodies(source) {
  const bodies = [];
  const re = /(?:^|\n)\s*(?:private |public |protected )?(?:async )?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[\w<>[\]|\s.]+)?\s*\{/g;
  let m = re.exec(source);
  while (m) {
    const open = source.indexOf('{', m.index + m[0].length - 1);
    let depth = 0;
    let i = open;
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push({ name: m[1], body: source.slice(open, i + 1), offset: open });
    re.lastIndex = i;
    m = re.exec(source);
  }
  return bodies;
}

/** Collect `const NAME = <arithmetic>;` bindings that resolve to numbers. */
function localScope(body, base) {
  const scope = { ...base };
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+);/g;
  let m = re.exec(body);
  while (m) {
    const value = evalExpr(m[2], scope);
    if (value !== null) scope[m[1]] = value;
    m = re.exec(body);
  }
  return scope;
}

function optNumber(optsText, key, scope) {
  if (!optsText) return null;
  const m = new RegExp(`${key}\\s*:\\s*([^,}]+)`).exec(optsText);
  return m ? evalExpr(m[1], scope) : null;
}

export function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/**
 * Analyse one source file.
 * @returns {{violations: object[], skipped: object[], panels: number}}
 */
export function analyzeSource(source, { file, canvas }) {
  const base = {
    'CANVAS.WIDTH': canvas.width,
    'CANVAS.HEIGHT': canvas.height,
    Math: NaN,
  };
  delete base.Math;
  const violations = [];
  const overlaps = [];
  const skipped = [];
  let panels = 0;

  for (const fn of functionBodies(source)) {
    const panelCalls = findCalls(fn.body, 'Menu.panel');
    if (panelCalls.length !== 1) continue;
    const scope = localScope(fn.body, base);
    const [, px, py, pw, ph] = panelCalls[0].args;
    const cx = evalExpr(px, scope);
    const cy = evalExpr(py, scope);
    const w = evalExpr(pw, scope);
    const h = evalExpr(ph, scope);
    if ([cx, cy, w, h].some((v) => v === null)) {
      skipped.push({ file, fn: fn.name, reason: 'panel box did not resolve to numbers' });
      continue;
    }
    panels += 1;
    const panel = { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2, w, h };
    const buttons = [];

    for (const call of findCalls(fn.body, 'Menu.button')) {
      const [, bxText, byText, labelText, , optsText] = call.args;
      const bx = evalExpr(bxText, scope);
      const by = evalExpr(byText, scope);
      if (bx === null || by === null) {
        skipped.push({ file, fn: fn.name, reason: `button position did not resolve (${bxText}, ${byText})` });
        continue;
      }
      const optW = optNumber(optsText, 'width', scope);
      const optH = optNumber(optsText, 'height', scope);
      const bh = Math.max(MIN_BUTTON_H, optH ?? MIN_BUTTON_H);
      buttons.push({
        label: (labelText || '').trim().slice(0, 40),
        line: lineOf(source, fn.offset + call.start),
        block: blockAt(fn.body, call.start),
        bx, by, w: optW, h: bh,
      });
      const box = { top: by - bh / 2, bottom: by + bh / 2 };
      const out = {
        top: Math.round(panel.top - box.top),
        bottom: Math.round(box.bottom - panel.bottom),
        left: 0,
        right: 0,
      };
      if (optW !== null) {
        out.left = Math.round(panel.left - (bx - optW / 2));
        out.right = Math.round((bx + optW / 2) - panel.right);
      }
      const worst = Math.max(out.top, out.bottom, out.left, out.right);
      if (worst > 0) {
        // GEOMETRY here is exact, but ASSOCIATION is not: a button merely built
        // in the same function is not necessarily a child of the panel. When the
        // button's CENTRE lies inside the panel (or on its edge) it was clearly
        // meant to sit in it and only spills because of its own size - that is a
        // proven layout bug. A centre far outside the panel is more likely a
        // separate screen-level element, so it is reported as `suspect` and does
        // not gate the build.
        const centreInside = bx >= panel.left - 2 && bx <= panel.right + 2
          && by >= panel.top - 2 && by <= panel.bottom + 2;
        const centreOutsidePx = Math.round(Math.max(
          panel.top - by, by - panel.bottom, panel.left - bx, bx - panel.right, 0,
        ));
        violations.push({
          file,
          fn: fn.name,
          line: lineOf(source, fn.offset + call.start),
          label: (labelText || '').trim().slice(0, 40),
          buttonCentre: [bx, by],
          buttonMinSize: [optW, bh],
          panelBox: [Math.round(panel.left), Math.round(panel.top), panel.w, panel.h],
          outsideBy: Object.fromEntries(Object.entries(out).filter(([, v]) => v > 0)),
          worstPx: worst,
          confidence: centreInside ? 'confirmed' : 'suspect',
          centreOutsidePx,
        });
      }
    }

    /*
     * Buttons that collide with EACH OTHER.
     *
     * Menu.button enforces h = Math.max(44, ...) for touch targets, so any pair
     * spaced less than 44px apart vertically now overlaps even though the
     * hand-written coordinates predate that floor. Using the 44px minimum keeps
     * this sound: if the smallest possible boxes already intersect, the real
     * (larger) ones certainly do. Horizontal overlap is only asserted when it is
     * guaranteed - both widths known and intersecting, or a shared centre x,
     * which both boxes must contain whatever their widths turn out to be.
     */
    for (let i = 0; i < buttons.length; i += 1) {
      for (let j = i + 1; j < buttons.length; j += 1) {
        const a = buttons[i];
        const b = buttons[j];
        // Buttons in different blocks are usually the arms of an if/else and
        // never exist at the same time, so pairing them would be a false alarm.
        if (a.block !== b.block) continue;
        const dy = Math.min(a.by + a.h / 2, b.by + b.h / 2) - Math.max(a.by - a.h / 2, b.by - b.h / 2);
        if (dy <= 0) continue;
        let xOverlaps;
        if (a.w !== null && b.w !== null) {
          xOverlaps = Math.min(a.bx + a.w / 2, b.bx + b.w / 2) - Math.max(a.bx - a.w / 2, b.bx - b.w / 2) > 0;
        } else if (a.bx === b.bx) {
          xOverlaps = true;
        } else {
          continue; // width unknown and centres differ - cannot prove it
        }
        if (!xOverlaps) continue;
        overlaps.push({
          file,
          fn: fn.name,
          line: Math.min(a.line, b.line),
          pair: [a.label, b.label],
          centres: [[a.bx, a.by], [b.bx, b.by]],
          gapPx: Math.round(Math.abs(a.by - b.by)),
          minHeights: [a.h, b.h],
          overlapPx: Math.round(dy),
        });
      }
    }
  }
  return { violations, overlaps, skipped, panels };
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Read a package's CANVAS design band from its GameConfig. */
export function canvasFor(packageDir) {
  const config = join(packageDir, 'src/config/GameConfig.ts');
  try {
    const text = readFileSync(config, 'utf8');
    const w = /WIDTH:\s*(\d+)/.exec(text);
    const h = /HEIGHT:\s*(\d+)/.exec(text);
    if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
  } catch { /* fall through */ }
  return { width: 960, height: 540 };
}

/** Analyse a whole package directory. */
export function analyzePackage(packageDir) {
  const canvas = canvasFor(packageDir);
  const result = { violations: [], overlaps: [], skipped: [], panels: 0, canvas };
  let files = [];
  try {
    files = walk(join(packageDir, 'src'));
  } catch {
    return result;
  }
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('Menu.panel(')) continue;
    const one = analyzeSource(source, { file, canvas });
    result.violations.push(...one.violations);
    result.overlaps.push(...one.overlaps);
    result.skipped.push(...one.skipped);
    result.panels += one.panels;
  }
  result.violations.sort((a, b) => b.worstPx - a.worstPx);
  result.overlaps.sort((a, b) => b.overlapPx - a.overlapPx);
  return result;
}
