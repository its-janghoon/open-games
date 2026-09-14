/**
 * Font stack for every label in this game.
 *
 * No webfont, deliberately. Subsetting is blocked on this host (no pyftsubset or hb-subset), and this game needs
 * only 178 distinct Korean characters — so the choice would be between shipping a FULL Korean face at roughly half a
 * megabyte against a 357 KB cold-load budget, or reusing another game's subset, which was measured and misses 7 to
 * 13 of the characters this game actually renders. Both are worse than nothing.
 *
 * What costs nothing is naming Korean faces explicitly instead of trusting `system-ui` to be Korean-capable. A bare
 * `monospace` is the worst case of all — generic monospace families frequently carry no Korean at all, and then every Korean label is tofu — on
 * exactly the low-end hardware this project is for. The landing page already does this, and this is the same list.
 */
export const FONT_STACK =
  "ui-monospace, SFMono-Regular, Menlo, 'D2Coding', 'NanumGothicCoding', " +
  "'Noto Sans Mono CJK KR', monospace";
