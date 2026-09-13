#!/usr/bin/env python3
"""
gen_sprites.py - Original pixel-art asset generator for ARENA CHAMPIONS
(아레나 챔피언스).

Everything produced by this script is ORIGINAL art authored programmatically for
this project. Nothing is traced, ripped, or derived from any existing IP. Arena
Champions is an ORIGINAL single-player tactical arena battler, merely INSPIRED BY
the lane-pushing genre - it does NOT use any third-party name, champion,
faction, story, logo, art, or audio.

WHY THIS EXISTS
---------------
champs was the only game in this repo with ZERO sprite assets: every champion,
minion and structure was drawn at runtime from `svgArt.ts` inline SVG and Phaser
Graphics primitives. That is why it read as unfinished placeholder art next to
its four siblings, which each ship 23-37 generated PNGs from their own
`tools/gen_sprites.py`. This script is that missing pipeline.

DESIGN LANGUAGE
---------------
Carried over from the vector pass so the identity is continuous:
  ROLE  -> body silhouette   (marksman wedge, assassin diamond, bruiser shield,
                              mage hexagon, enchanter ring)
  CHAMP -> an oversized WEAPON bolted onto that body, which is what separates
           the two champions that share each role.

FRAMES (horizontal strip, one row, matching wirework's sheet convention)
  0 IDLE    1 RUN_A    2 RUN_B    3 ATTACK    4 HURT
`load.spritesheet` slices by FRAME_W/FRAME_H; RUN_A/RUN_B alternate for the walk
cycle, ATTACK is the weapon extended, HURT is the flash/recoil pose.

Run:  ../../../.kiro/crew-venv/bin/python3 tools/gen_sprites.py
      (any interpreter with Pillow; the repo's system python3 has none)
Out:  public/assets/sprites/*.png
"""

import os
from PIL import Image

# --------------------------------------------------------------------------
# Output geometry
#
# Champions are authored around cx=20 in a nominal 40x40 space, but a weapon on
# the ATTACK frame reaches further than that and `outline_opaque()` then adds a
# pixel beyond the art - six champions' weapons (and thornwarden's flail on
# EVERY frame) ran into the border and had their outline sliced off. So the
# emitted frame is larger than the authoring space and every draw is shifted by
# (ART_OX, ART_OY): the body lands centred in the bigger frame and the widest
# weapon still clears the edge. Sibling games likewise use per-entity frame
# sizes rather than one global 32x32.
# --------------------------------------------------------------------------
FRAME_W, FRAME_H = 64, 56
ART_OX, ART_OY = 8, 12
FRAMES = 5  # IDLE, RUN_A, RUN_B, ATTACK, HURT
IDLE, RUN_A, RUN_B, ATTACK, HURT = range(FRAMES)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets', 'sprites')

TRANSPARENT = (0, 0, 0, 0)
OUTLINE = (8, 14, 22, 255)
WHITE = (255, 255, 255, 255)

# Ally/enemy rim, matching TEAM_RIM in src/game/render/svgArt.ts. The outline is
# drawn in the TEAM colour rather than flat dark, because that contour is the
# only ally/enemy tell at battle zoom - the accent already encodes WHICH
# champion, so it cannot also encode which side. Every sheet is emitted twice,
# once per team, and the scene picks by the spec's `team`.
TEAM_RIM = {
    'ally': (0x8F, 0xD7, 0xFF),
    'enemy': (0xFF, 0x8A, 0x7A),
}


# --------------------------------------------------------------------------
# Colour helpers
# --------------------------------------------------------------------------
def hex_rgb(s):
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def shade(rgb, f):
    """f > 1 lightens toward white, f < 1 darkens toward black."""
    if f >= 1:
        t = min(1.0, f - 1.0)
        return tuple(int(c + (255 - c) * t) for c in rgb)
    return tuple(int(c * max(0.0, f)) for c in rgb)


def rgba(rgb, a=255):
    return (rgb[0], rgb[1], rgb[2], a)


# --------------------------------------------------------------------------
# Primitive raster helpers. Everything writes into a per-frame pixel buffer so
# the art stays hard-edged (no anti-aliasing) - nearest-neighbour pixel art.
# --------------------------------------------------------------------------
class Frame:
    def __init__(self, w=FRAME_W, h=FRAME_H, ox=None, oy=None):
        self.w, self.h = w, h
        # Authoring offset. Drawing helpers use the nominal coordinates the art
        # was designed in; `set` shifts them into the larger emitted frame.
        self.ox = ART_OX if ox is None else ox
        self.oy = ART_OY if oy is None else oy
        self.px = [[TRANSPARENT for _ in range(w)] for _ in range(h)]

    def set(self, x, y, c):
        """Plot in AUTHORING space (offset applied)."""
        self.set_raw(x + self.ox, y + self.oy, c)

    def set_raw(self, x, y, c):
        """Plot in BUFFER space - used when copying one buffer into another,
        where the offset has already been baked in."""
        if 0 <= x < self.w and 0 <= y < self.h and c[3]:
            self.px[y][x] = c

    def get(self, x, y):
        """Read in AUTHORING space."""
        bx, by = x + self.ox, y + self.oy
        if 0 <= bx < self.w and 0 <= by < self.h:
            return self.px[by][bx]
        return TRANSPARENT

    def rect(self, x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.set(x, y, c)

    def line(self, x0, y0, x1, y1, c, thick=1):
        """Integer Bresenham line, optionally thickened into a square brush."""
        x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        while True:
            for oy in range(thick):
                for ox in range(thick):
                    self.set(x0 + ox - thick // 2, y0 + oy - thick // 2, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy

    def poly(self, pts, c):
        """Scanline-fill a closed polygon (even-odd), no anti-aliasing."""
        ys = [p[1] for p in pts]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            xs = []
            n = len(pts)
            for i in range(n):
                ax, ay = pts[i]
                bx, by = pts[(i + 1) % n]
                if ay == by:
                    continue
                if min(ay, by) <= y < max(ay, by):
                    xs.append(ax + (y - ay) * (bx - ax) / (by - ay))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(int(round(xs[i])), int(round(xs[i + 1])) + 1):
                    self.set(x, y, c)

    def disc(self, cx, cy, r, c):
        for y in range(int(cy - r), int(cy + r) + 1):
            for x in range(int(cx - r), int(cx + r) + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    self.set(x, y, c)

    def ring(self, cx, cy, r, c, w=1):
        for y in range(int(cy - r - w), int(cy + r + w) + 1):
            for x in range(int(cx - r - w), int(cx + r + w) + 1):
                d2 = (x - cx) ** 2 + (y - cy) ** 2
                if (r - w) ** 2 <= d2 <= r * r:
                    self.set(x, y, c)

    def outline_opaque(self, c=OUTLINE):
        """Trace a 1px dark border around every opaque cluster - the single
        biggest readability win at this size, and what makes a unit pop off the
        lane floor at battle zoom. Operates purely in BUFFER space."""
        edges = []
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x][3]:
                    continue
                touching = False
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < self.w and 0 <= ny < self.h and self.px[ny][nx][3]:
                        touching = True
                        break
                if touching:
                    edges.append((x, y))
        for x, y in edges:
            self.px[y][x] = c

    def flash(self, amount=0.65):
        """Wash every opaque pixel toward white - the HURT frame's hit flash."""
        for y in range(self.h):
            for x in range(self.w):
                r, g, b, a = self.px[y][x]
                if not a:
                    continue
                self.px[y][x] = (
                    int(r + (255 - r) * amount),
                    int(g + (255 - g) * amount),
                    int(b + (255 - b) * amount),
                    a,
                )


# --------------------------------------------------------------------------
# Role bodies. Authored around cx=20 with the feet near y=32 so there is room
# above for a raised weapon and below for the ground shadow the scene draws.
# --------------------------------------------------------------------------
def body_marksman(f, base, lit, dark):
    """Upward arrowhead wedge."""
    f.poly([(20, 8), (31, 32), (20, 26), (9, 32)], rgba(base))
    f.poly([(20, 8), (31, 32), (20, 26)], rgba(dark))
    f.poly([(20, 8), (20, 26), (9, 32)], rgba(lit))


def body_assassin(f, base, lit, dark):
    """Tall diamond."""
    f.poly([(20, 6), (31, 20), (20, 34), (9, 20)], rgba(base))
    f.poly([(20, 6), (31, 20), (20, 34)], rgba(dark))
    f.poly([(20, 6), (20, 34), (9, 20)], rgba(lit))


def body_bruiser(f, base, lit, dark):
    """Flat-topped shield plate - visually the heaviest."""
    f.rect(9, 10, 31, 24, rgba(base))
    f.poly([(9, 24), (31, 24), (20, 34)], rgba(base))
    f.rect(9, 10, 19, 24, rgba(lit))
    f.poly([(20, 24), (31, 24), (20, 34)], rgba(dark))


def body_mage(f, base, lit, dark):
    """Hexagon cell."""
    f.poly([(20, 6), (31, 13), (31, 27), (20, 34), (9, 27), (9, 13)], rgba(base))
    f.poly([(20, 6), (31, 13), (31, 27), (20, 34)], rgba(dark))
    f.poly([(20, 6), (20, 34), (9, 27), (9, 13)], rgba(lit))


def body_enchanter(f, base, lit, dark):
    """Ring / ball - no point, no edge."""
    f.disc(20, 20, 12, rgba(base))
    for y in range(8, 33):
        for x in range(8, 21):
            if (x - 20) ** 2 + (y - 20) ** 2 <= 144:
                f.set(x, y, rgba(lit))
    f.ring(20, 20, 12, rgba(dark), 2)


BODIES = {
    'marksman': body_marksman,
    'assassin': body_assassin,
    'bruiser': body_bruiser,
    'mage': body_mage,
    'enchanter': body_enchanter,
}


# --------------------------------------------------------------------------
# Weapons. `reach` shifts the weapon outward on the ATTACK frame so the strike
# is legible as a distinct pose rather than a colour change.
# --------------------------------------------------------------------------
def w_rocket_launcher(f, steel, hot, reach):
    """ashborne: shoulder-fired launcher with a warhead in the muzzle.

    x0 starts at 11 so the ATTACK frame's `reach` still leaves the warhead tip
    (x0 + 23) inside the 40px frame - at 14 the tip landed on x=41 and was
    silently clipped, which showed up as ATTACK having FEWER opaque pixels than
    IDLE."""
    x0, y0 = 11 + reach, 18
    f.rect(x0, y0, x0 + 16, y0 + 4, rgba(steel))
    f.rect(x0 - 3, y0 - 1, x0, y0 + 5, rgba(shade(steel, 0.7)))     # blast bell
    f.rect(x0 + 16, y0 - 1, x0 + 18, y0 + 5, rgba(steel))            # muzzle ring
    f.poly([(x0 + 18, y0), (x0 + 23, y0 + 2), (x0 + 18, y0 + 4)], rgba(hot))
    f.rect(x0 + 4, y0 - 2, x0 + 7, y0 - 1, rgba(shade(steel, 1.3)))  # sight


def w_railgun(f, steel, hot, reach):
    """duskarrow: twin coil barrels."""
    x0 = 14 + reach
    f.rect(x0, 17, x0 + 19, 18, rgba(steel))
    f.rect(x0, 22, x0 + 19, 23, rgba(steel))
    for cx in (x0 + 4, x0 + 9, x0 + 14):
        f.rect(cx, 15, cx + 1, 25, rgba(hot))
    f.rect(x0 - 3, 15, x0, 25, rgba(shade(steel, 0.7)))
    f.rect(x0 + 19, 19, x0 + 21, 21, rgba(hot))


def w_ninja_rocket(f, steel, hot, reach):
    """nightveil: rocket strapped on the back, exhaust burning."""
    f.line(12, 30 - reach, 26, 12 - reach, rgba(steel), 3)
    f.poly([(26, 12 - reach), (31, 7 - reach), (28, 15 - reach)], rgba(hot))
    f.poly([(12, 30 - reach), (7, 36 - reach), (13, 34 - reach)], rgba(hot))  # plume
    f.line(9, 16, 15, 18, rgba(shade(steel, 0.55)), 2)                        # headband
    f.line(9, 16, 4, 22, rgba(shade(steel, 0.55)), 1)


def w_sickles(f, steel, hot, reach):
    """grimtrail: twin hooked blades."""
    for sx in (-1, 1):
        cx = 20 + sx * (7 + reach)
        f.line(cx, 15, cx + sx * 5, 21, rgba(steel), 2)
        f.line(cx + sx * 5, 21, cx + sx * 2, 27, rgba(steel), 2)
        f.set(cx + sx * 2, 28, rgba(hot))


def w_hammer(f, steel, hot, reach):
    """ironhold: slab shield plus a two-handed warhammer."""
    f.rect(4, 14, 8, 28, rgba(shade(steel, 0.8)))          # shield slab
    f.rect(6, 20, 7, 22, rgba(hot))
    f.line(30, 30, 33, 12 - reach, rgba(shade(steel, 0.6)), 2)
    f.rect(29, 6 - reach, 37, 12 - reach, rgba(steel))     # head
    f.rect(29, 8 - reach, 37, 9 - reach, rgba(hot))


def w_flail(f, steel, hot, reach):
    """thornwarden: spiked ball on a chain."""
    for i in range(5):
        f.set(26 + i, 20 - i * 2 - reach, rgba(shade(steel, 0.6)))
    cx, cy = 33, 9 - reach
    f.disc(cx, cy, 4, rgba(steel))
    for dx, dy in ((0, -6), (6, 0), (-6, 0), (0, 6), (4, -4), (-4, 4)):
        f.set(cx + dx, cy + dy, rgba(steel))
    f.set(cx - 1, cy - 1, rgba(hot))


def w_flame_cannon(f, steel, hot, reach):
    """embermage: stubby flame cannon with a lit muzzle.

    x0 at 12 (not 15) keeps the r=4 muzzle glow at x0+18 inside the frame once
    ATTACK adds `reach`; at 15 the glow's right edge fell on x=41 and clipped."""
    x0 = 12 + reach
    f.rect(x0, 18, x0 + 15, 24, rgba(steel))
    f.rect(x0 - 3, 17, x0, 25, rgba(shade(steel, 0.7)))
    f.disc(x0 + 18, 21, 4, rgba(hot))
    f.disc(x0 + 18, 21, 2, rgba(shade(hot, 1.5)))


def w_frost_lance(f, steel, hot, reach):
    """frostquill: long lance with a crystal head."""
    f.line(6, 32, 30 + reach, 10 - reach, rgba(steel), 2)
    tipx, tipy = 30 + reach, 10 - reach
    f.poly([(tipx, tipy - 4), (tipx + 5, tipy), (tipx, tipy + 4), (tipx - 3, tipy)], rgba(hot))
    f.set(tipx, tipy, rgba(WHITE[:3]))


def w_beam_fork(f, steel, hot, reach):
    """dawnsong: twin-prong emitter casting a support beam."""
    x0 = 26 + reach
    f.rect(20, 20, x0, 21, rgba(steel))
    f.rect(x0, 13, x0 + 1, 28, rgba(hot))
    f.line(x0, 13, x0 + 5, 9, rgba(hot), 1)
    f.line(x0, 28, x0 + 5, 32, rgba(hot), 1)
    for y in range(15, 27, 2):
        f.set(x0 + 3, y, rgba(shade(hot, 1.4)))


def w_missile_pods(f, steel, hot, reach):
    """wardlight: the rocket-launcher ball - a pod bolted to each flank."""
    for x0 in (2, 32):
        f.rect(x0, 16, x0 + 5, 26, rgba(shade(steel, 0.85)))
        f.set(x0 + 2, 19, rgba(OUTLINE[:3]))
        f.set(x0 + 2, 23, rgba(OUTLINE[:3]))
    f.rect(33, 8 - reach, 35, 15 - reach, rgba(steel))     # warhead climbing out
    f.poly([(33, 8 - reach), (34, 4 - reach), (35, 8 - reach)], rgba(hot))


# roster id -> (role, accent, weapon)
CHAMPIONS = [
    ('ashborne',    'marksman',  '#e8703a', w_rocket_launcher),
    ('nightveil',   'assassin',  '#8a4fff', w_ninja_rocket),
    ('ironhold',    'bruiser',   '#c9a227', w_hammer),
    ('embermage',   'mage',      '#2fa8e0', w_flame_cannon),
    ('dawnsong',    'enchanter', '#3ad6a5', w_beam_fork),
    ('thornwarden', 'bruiser',   '#5a9e3f', w_flail),
    ('grimtrail',   'assassin',  '#a12b3c', w_sickles),
    ('frostquill',  'mage',      '#6fd0e8', w_frost_lance),
    ('duskarrow',   'marksman',  '#d94fa0', w_railgun),
    ('wardlight',   'enchanter', '#9fb8ff', w_missile_pods),
]


def champion_frame(role, accent, weapon, which, team):
    """Build one animation frame for a champion, rimmed for `team`."""
    base = hex_rgb(accent)
    lit, dark = shade(base, 1.28), shade(base, 0.6)
    steel = shade(base, 0.78)
    hot = shade(base, 1.6)
    rim = rgba(shade(TEAM_RIM[team], 0.62))

    f = Frame()
    # RUN bob: the whole body rises a pixel on RUN_A and drops on RUN_B, which
    # is what reads as a walk cycle at this size (limbs are too small to sell).
    bob = {IDLE: 0, RUN_A: -1, RUN_B: 1, ATTACK: 0, HURT: 1}[which]
    # ATTACK also LUNGES the whole body forward. The first cut only pushed the
    # weapon 4px and nothing else, which at battle zoom was invisible - the
    # attack pose fires correctly (180ms, priority 1) but simply could not be
    # SEEN. A body shift plus a longer weapon throw plus a strike arc makes the
    # swing register.
    lunge = 4 if which == ATTACK else 0
    body = Frame()
    BODIES[role](body, base, lit, dark)
    # body.px is already in BUFFER space (the offset was applied as it was
    # drawn), so copy it raw - going through `set` would offset it a second time.
    for y in range(FRAME_H):
        for x in range(FRAME_W):
            f.set_raw(x + lunge, y + bob, body.px[y][x])

    # ATTACK throws the weapon well clear of the body; other frames keep it in.
    reach = 9 if which == ATTACK else 0
    weapon(f, steel, hot, reach)

    # Strike arc: a bright crescent thrown ahead of the weapon on the swing.
    if which == ATTACK:
        for i in range(-6, 7):
            f.set(44 + abs(i) // 3, 24 + i, rgba(hot))
            f.set(45 + abs(i) // 3, 24 + i, rgba(shade(hot, 1.35)))

    # Glowing core: the single bright focal point, and the facing tell.
    f.disc(20 + lunge, 20 + bob, 3, rgba(hot))
    f.disc(20 + lunge, 20 + bob, 1, WHITE)

    f.outline_opaque(rim)
    if which == HURT:
        f.flash(0.7)
    return f
MINIONS = [
    ('melee',  '#7f8c9b', 'wedge'),
    ('ranged', '#8fa7c4', 'diamond'),
    ('siege',  '#a08256', 'block'),
]


# --------------------------------------------------------------------------
# Neutral MARKERS: jungle camps and the three map objectives. These are neutral
# units, so unlike champions/minions/structures they get NO team variant and no
# team rim - a neutral outline is itself the tell that nobody owns them.
# --------------------------------------------------------------------------
MARKER_W, MARKER_H = 32, 32
NEUTRAL_RIM = (0x6B, 0x7C, 0x8C)

MARKERS = [
    ('jungle', '#6f8f5a'),   # generic camp beast
    ('dragon', '#c2543a'),
    ('baron', '#7d5ab8'),    # 공허의 폭군
    ('herald', '#8a8f96'),   # 바위 파수꾼
]


def marker_frame(variant, accent, which):
    base = hex_rgb(accent)
    lit, dark = shade(base, 1.3), shade(base, 0.6)
    hot = shade(base, 1.75)
    f = Frame(MARKER_W, MARKER_H, ox=0, oy=0)
    bob = -1 if which == RUN_A else (1 if which == RUN_B else 0)
    lunge = 2 if which == ATTACK else 0
    y = bob

    if variant == 'jungle':
        # squat four-legged camp beast
        f.poly([(8, 20 + y), (24, 20 + y), (22, 27 + y), (10, 27 + y)], rgba(base))
        f.poly([(8, 20 + y), (16, 20 + y), (16, 27 + y), (10, 27 + y)], rgba(lit))
        f.poly([(20 + lunge, 12 + y), (28 + lunge, 14 + y), (27 + lunge, 21 + y), (19 + lunge, 20 + y)], rgba(base))
        f.poly([(21 + lunge, 12 + y), (23 + lunge, 7 + y), (25 + lunge, 13 + y)], rgba(dark))  # ear
        f.disc(25 + lunge, 17 + y, 1, rgba(hot))
        f.rect(10, 27 + y, 11, 30 + y, rgba(dark))
        f.rect(21, 27 + y, 22, 30 + y, rgba(dark))
    elif variant == 'dragon':
        # winged serpent: swept wings + long neck
        f.poly([(16, 16 + y), (3, 8 + y), (7, 20 + y)], rgba(dark))
        f.poly([(16, 16 + y), (29, 8 + y), (25, 20 + y)], rgba(base))
        f.poly([(12, 14 + y), (20, 14 + y), (18, 24 + y), (14, 24 + y)], rgba(base))
        f.poly([(18 + lunge, 12 + y), (26 + lunge, 6 + y), (22 + lunge, 14 + y)], rgba(lit))
        f.disc(22 + lunge, 10 + y, 1, rgba(hot))
        f.poly([(14, 24 + y), (18, 24 + y), (17, 30 + y), (15, 30 + y)], rgba(dark))
    elif variant == 'baron':
        # towering spiked maw
        f.poly([(10, 10 + y), (22, 10 + y), (24, 26 + y), (8, 26 + y)], rgba(base))
        f.poly([(10, 10 + y), (16, 10 + y), (16, 26 + y), (8, 26 + y)], rgba(lit))
        for sx in range(9, 24, 4):
            f.poly([(sx, 10 + y), (sx + 2, 3 + y), (sx + 4, 10 + y)], rgba(dark))
        # Maw OPENS on the lunge frame: without keying anything to `lunge` the
        # ATTACK frame was pixel identical to IDLE (4/5 unique).
        f.rect(12, 17 + y - lunge, 20, 21 + y + lunge, rgba(shade(base, 0.35)))
        f.disc(13, 14 + y, 1, rgba(hot))
        f.disc(19, 14 + y, 1, rgba(hot))
        f.rect(8, 26 + y, 24, 29 + y, rgba(dark))
    else:  # herald - a stone sentinel block
        f.rect(8, 9 + y, 24, 27 + y, rgba(base))
        f.rect(8, 9 + y, 15, 27 + y, rgba(lit))
        f.rect(11, 5 + y, 21, 9 + y, rgba(dark))
        f.disc(16 + lunge, 17 + y, 3, rgba(hot))
        f.ring(16 + lunge, 17 + y, 5, rgba(dark), 1)

    f.outline_opaque(rgba(NEUTRAL_RIM))
    if which == HURT:
        f.flash(0.7)
    return f


# --------------------------------------------------------------------------
# VFX: authored in WHITE so the scene can `setTint` them with each ability's
# colour at runtime. Baking one sheet per (kind x ability colour) would multiply
# out for no benefit - the shape is what carries the meaning, the colour is data.
# --------------------------------------------------------------------------
VFX_W, VFX_H = 24, 24
VFX_KINDS = ['projectile', 'beam', 'aoeRing', 'castFlare', 'impact', 'heal', 'stun', 'death']


def vfx_frame(kind):
    f = Frame(VFX_W, VFX_H, ox=0, oy=0)
    W = (255, 255, 255, 255)
    D = (255, 255, 255, 140)   # softer falloff, still tintable
    c = 12

    if kind == 'projectile':
        f.disc(15, c, 3, W)
        f.rect(4, c - 1, 12, c + 1, D)
    elif kind == 'beam':
        f.rect(0, c - 2, 23, c + 2, D)
        f.rect(0, c - 1, 23, c + 1, W)
    elif kind == 'aoeRing':
        f.ring(c, c, 10, W, 2)
        f.ring(c, c, 6, D, 1)
    elif kind == 'castFlare':
        for dx, dy in ((0, -10), (0, 10), (-10, 0), (10, 0)):
            f.line(c, c, c + dx, c + dy, W, 2)
        for dx, dy in ((-7, -7), (7, -7), (-7, 7), (7, 7)):
            f.line(c, c, c + dx, c + dy, D, 1)
        f.disc(c, c, 3, W)
    elif kind == 'impact':
        for dx, dy in ((-9, -5), (9, -5), (-9, 5), (9, 5), (0, -10), (0, 10)):
            f.line(c, c, c + dx, c + dy, W, 2)
        f.disc(c, c, 2, W)
    elif kind == 'heal':
        f.rect(c - 2, c - 8, c + 2, c + 8, W)
        f.rect(c - 8, c - 2, c + 8, c + 2, W)
        f.disc(4, 5, 1, D)
        f.disc(19, 18, 1, D)
    elif kind == 'stun':
        for i, x in enumerate(range(4, 21, 4)):
            f.disc(x, c - 6 if i % 2 == 0 else c + 6, 2, W)
        f.ring(c, c, 9, D, 1)
    else:  # death - a dissipating burst
        f.ring(c, c, 9, D, 2)
        for dx, dy in ((-6, -6), (6, -6), (-6, 6), (6, 6)):
            f.line(c + dx // 2, c + dy // 2, c + dx, c + dy, W, 1)
        f.disc(c, c, 3, D)
    return f


MINION_W, MINION_H = 28, 24


# --------------------------------------------------------------------------
# Minions + structures. Same language, simpler: minions get a march cycle plus a
# lunge, structures are static but keep the rim so they read as team-owned.
# --------------------------------------------------------------------------
def minion_frame(accent, shape, which, team):
    base = hex_rgb(accent)
    lit, dark = shade(base, 1.25), shade(base, 0.62)
    # 28 wide, not 24: the ATTACK lunge plus the outline pixel needs slack on
    # the right or the striking frame loses its border to the edge.
    f = Frame(MINION_W, MINION_H, ox=2, oy=0)
    bob = -1 if which == RUN_A else (1 if which == RUN_B else 0)
    # ATTACK lunges forward instead of bobbing: without it the frame was pixel
    # identical to IDLE (both bob 0, and a minion carries no weapon to extend),
    # so the sheet only had four distinct frames and a striking minion read as
    # standing still.
    lunge = 3 if which == ATTACK else 0
    if shape == 'wedge':
        f.poly([(12 + lunge, 5 + bob), (19 + lunge, 19 + bob),
                (12 + lunge, 15 + bob), (5 + lunge, 19 + bob)], rgba(base))
        f.poly([(12 + lunge, 5 + bob), (19 + lunge, 19 + bob),
                (12 + lunge, 15 + bob)], rgba(dark))
    elif shape == 'diamond':
        f.poly([(12 + lunge, 4 + bob), (19 + lunge, 12 + bob),
                (12 + lunge, 20 + bob), (5 + lunge, 12 + bob)], rgba(base))
        f.poly([(12 + lunge, 4 + bob), (19 + lunge, 12 + bob),
                (12 + lunge, 20 + bob)], rgba(dark))
    else:
        f.rect(5 + lunge, 7 + bob, 19 + lunge, 19 + bob, rgba(base))
        f.rect(5 + lunge, 7 + bob, 11 + lunge, 19 + bob, rgba(lit))
    f.disc(12 + lunge, 12 + bob, 2, rgba(shade(base, 1.7)))
    f.outline_opaque(rgba(shade(TEAM_RIM[team], 0.62)))
    if which == HURT:
        f.flash(0.7)
    return f


def structure_frame(accent, tall, team):
    base = hex_rgb(accent)
    lit, dark = shade(base, 1.2), shade(base, 0.6)
    f = Frame(32, 48, ox=0, oy=0)
    top = 48 - tall
    f.rect(9, top, 23, 46, rgba(base))
    f.rect(9, top, 15, 46, rgba(lit))
    f.rect(6, top - 4, 26, top, rgba(dark))          # crown
    for x in range(7, 26, 4):                        # crenellations
        f.rect(x, top - 7, x + 1, top - 4, rgba(dark))
    f.disc(16, top + 8, 3, rgba(shade(base, 1.8)))   # power core
    f.outline_opaque(rgba(shade(TEAM_RIM[team], 0.62)))
    return f


# --------------------------------------------------------------------------
# Sheet assembly
# --------------------------------------------------------------------------
def write_sheet(name, frames, fw, fh):
    img = Image.new('RGBA', (fw * len(frames), fh), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        for y in range(fh):
            for x in range(fw):
                c = fr.px[y][x]
                if c[3]:
                    img.putpixel((i * fw + x, y), c)
    path = os.path.join(OUT_DIR, f'{name}.png')
    img.save(path)
    return path, img.size


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    written = []
    generic = {'marksman': w_rocket_launcher, 'assassin': w_sickles,
               'bruiser': w_hammer, 'mage': w_flame_cannon,
               'enchanter': w_beam_fork}

    for team in ('ally', 'enemy'):
        for cid, role, accent, weapon in CHAMPIONS:
            frames = [champion_frame(role, accent, weapon, i, team) for i in range(FRAMES)]
            written.append(write_sheet(f'champion_{cid}_{team}', frames, FRAME_W, FRAME_H))

        # Role-generic fallbacks, so an unknown / `generic-<role>` id still
        # resolves to a real texture instead of a missing-asset box.
        for role, weapon in generic.items():
            frames = [champion_frame(role, '#9aa7b4', weapon, i, team) for i in range(FRAMES)]
            written.append(write_sheet(f'champion_generic-{role}_{team}', frames, FRAME_W, FRAME_H))

        for mid, accent, shape in MINIONS:
            frames = [minion_frame(accent, shape, i, team) for i in range(FRAMES)]
            written.append(write_sheet(f'minion_{mid}_{team}', frames, MINION_W, MINION_H))

        for sid, accent, tall in (('turret', '#b9843c', 30), ('inhibitor', '#7f6ad8', 24),
                                  ('nexus', '#d9b86c', 38)):
            written.append(
                write_sheet(f'structure_{sid}_{team}', [structure_frame(accent, tall, team)], 32, 48))

    # Neutral markers + tintable VFX: no team dimension.
    for variant, accent in MARKERS:
        frames = [marker_frame(variant, accent, i) for i in range(FRAMES)]
        written.append(write_sheet(f'marker_{variant}', frames, MARKER_W, MARKER_H))
    for kind in VFX_KINDS:
        written.append(write_sheet(f'vfx_{kind}', [vfx_frame(kind)], VFX_W, VFX_H))

    for path, size in written:
        print(f'{size[0]:4d}x{size[1]:<3d} {os.path.relpath(path, os.getcwd())}')
    print(f'\n{len(written)} sheets ({FRAMES} frames each for champions/minions) '
          f'- champion {FRAME_W}x{FRAME_H}, minion {MINION_W}x{MINION_H}, structure 32x48')


if __name__ == '__main__':
    main()
