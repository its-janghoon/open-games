/**
 * Static check: a Text drawn inside a BOUNDED container must declare a wrap
 * width.
 *
 * This exists because of a real defect. whiteout's objective strip put its
 * instruction line and a Skip button in one 600x44 frame, and the Text had no
 * `wordWrap`. A Phaser Text lays out on a single line however long its string
 * is, so the instruction ran under the button and out past the frame - a stray
 * "ly." ended up floating outside the panel. Nothing caught it: the panel-bounds
 * checker looks at BUTTON geometry, and no test renders that string.
 *
 * Note what is and is not provable here. Text OVERFLOW cannot be decided
 * statically, because the string comes from a translation table at runtime and
 * the same objective is one line in English and two in Korean. What IS decidable
 * is the policy that prevents it regardless of language: text inside a bounded
 * frame declares how wide it may get. So this checks for the missing wrap width,
 * not for the overflow itself.
 *
 * Confidence split, mirroring the panel checker so the gate only ever blocks on
 * something certain:
 *   confirmed - the Text's content is a translation call, so its length is
 *               genuinely unknown and unbounded. This gates the build.
 *   suspect   - any other unwrapped Text in a bounded container (a numeric
 *               readout, a fixed glyph). Reported, never gating: "0/100" cannot
 *               overflow a 460px card.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { findCalls, functionBodies, lineOf } from './panel-bounds.mjs';

/** Calls that establish a container with a known, finite width. */
const BOUNDING_CALLS = ['Menu.panel', 'this.add.rectangle', '.rectangle'];

/** How a localized string reaches a Text in these packages. */
const TRANSLATION_CALLS = ['tr(', 'translate(', 't('];

/**
 * Frame-width identifiers a positioning expression is built from, paired with
 * the direction it offsets in: `x - w / 2 + 14` is LEFT of the frame's centre,
 * `x + w / 2 - 42` is RIGHT of it.
 */
function frameAnchors(expr) {
  const out = [];
  const re = /([-+])\s*([A-Za-z_$][\w$]*)\s*\/\s*2/g;
  let m = re.exec(expr);
  while (m) {
    out.push({ dir: m[1], width: m[2] });
    m = re.exec(expr);
  }
  return out;
}

/**
 * Textual `const NAME = <expr>;` bindings in a body, so an anchor hoisted into a
 * local reads the same as one written inline.
 *
 * Without this the check had a FALSE NEGATIVE on the very file it was written
 * for: the fixed banner hoists its text origin into `const textLeft = bannerX -
 * bannerW / 2 + ...`, so removing the wrap width again was not detected - the x
 * argument was the bare identifier `textLeft` and the rule never saw the frame
 * width in it. Caught by re-running the regression check rather than trusting the
 * clean pass.
 */
function aliases(body) {
  const out = {};
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+);/g;
  let m = re.exec(body);
  while (m) {
    out[m[1]] = m[2];
    m = re.exec(body);
  }
  return out;
}

/** Anchors in an expression, following a one-level local alias if it is one. */
function anchorsOf(expr, alias) {
  const direct = frameAnchors(expr);
  if (direct.length > 0) return direct;
  const key = expr.trim();
  return alias[key] ? frameAnchors(alias[key]) : [];
}

/**
 * Pairs of (left-anchored text, right-anchored button) that divide one frame.
 *
 * Two earlier, looser rules were rejected before this one. "An unwrapped Text in
 * a function that draws a rectangle" produced 57 findings, nearly all bogus - a
 * centred `tr('brand.name')` title flagged because the same function drew a
 * loading bar it was never inside. Adding "and the function also makes a button"
 * only cut that to 26, still flagging headings in large overlays that share
 * nothing but a close button.
 *
 * What IS decidable syntactically is the shape that actually broke: a text
 * positioned from MINUS half a frame width and a button positioned from PLUS
 * half of that SAME identifier. They provably divide one fixed span, so a text
 * with no wrap width provably has no idea where to stop.
 */
function sharedFrameTexts(body) {
  const alias = aliases(body);
  const buttons = [];
  for (const call of findCalls(body, 'Menu.button')) {
    if (call.args.length < 2) continue;
    for (const a of anchorsOf(call.args[1], alias)) {
      if (a.dir === '+') buttons.push(a.width);
    }
  }
  if (buttons.length === 0) return [];

  const found = [];
  for (const call of findCalls(body, '.text')) {
    if (call.args.length < 3) continue;
    for (const a of anchorsOf(call.args[0], alias)) {
      if (a.dir === '-' && buttons.includes(a.width)) {
        found.push({ call, width: a.width });
        break;
      }
    }
  }
  return found;
}

/** The text-style argument of an `add.text(x, y, content, style)` call. */
function styleArg(args) {
  return args.length >= 4 ? args.slice(3).join(',') : '';
}

function contentArg(args) {
  return args.length >= 3 ? args[2] : '';
}

export function analyzeTextWrap(source, { file }) {
  const violations = [];
  for (const fn of functionBodies(source)) {
    for (const { call, width } of sharedFrameTexts(fn.body)) {
      const style = styleArg(call.args);
      if (style.includes('wordWrap') || style.includes('fixedWidth')) continue;

      const content = contentArg(call.args);
      const localized = TRANSLATION_CALLS.some((t) => content.includes(t));
      // A Text created with an empty string gets its content from setText later,
      // so its length is just as unknown as a translation's - and that is not a
      // corner case, it is the exact line that overflowed: the objective strip's
      // instruction was built empty and filled per objective each frame.
      const deferred = /^(''|""|``)$/.test(content.trim());
      const unbounded = localized || deferred;
      violations.push({
        file,
        fn: fn.name,
        line: lineOf(source, fn.offset + call.start),
        frame: width,
        content: deferred ? '(set later via setText)' : content.trim().slice(0, 48),
        confidence: unbounded ? 'confirmed' : 'suspect',
        reason: unbounded
          ? `${deferred ? 'deferred' : 'localized'} text and a button both anchored to ${width} with no wordWrap`
          : `text and a button both anchored to ${width} with no wordWrap`,
      });
    }
  }
  return violations;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

export function analyzeTextWrapPackage(packageDir) {
  const src = join(packageDir, 'src');
  let files = [];
  try {
    files = walk(src);
  } catch {
    return { violations: [] };
  }
  const violations = [];
  for (const file of files) {
    violations.push(...analyzeTextWrap(readFileSync(file, 'utf8'), { file }));
  }
  return { violations };
}
