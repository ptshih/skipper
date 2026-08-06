#!/usr/bin/env python3
"""
Home-hero poster exploration — round 1, DAY only.

Spec: ../../../../../docs/designs/home-hero-poster.md

Why DAY only in round 1: DESIGN §4 makes day the REFERENCE theme and a daylight
contrast failure blocking, so day gets designed and judged first. Dusk renders
here too (`--dusk`) but is not the round-1 decision.

Why these compositions and not a free-form hero: the cold open is NOT empty. A
real screenshot (1320x2868, iPhone 17 Pro Max) puts five OPAQUE `paperRaised`
cards across the middle of the screen, so a full-bleed poster is mostly HIDDEN
rather than merely hard to read. The Z_ constants below are measured off that
screenshot and every composition is judged against them. `A-fullbleed` exists to
SHOW the occlusion, not to win.

WPA grammar this follows (see README): reduce the landscape to layered planes —
sky, horizon, foreground — with overlapping shapes and diagonal movement, in 2-5
flat inks with hard edges. No gradients: silkscreen cannot make one.

Subject: Emerald Bay from Inspiration Point. The lake's only enclosed bay and
only island, already this repo's canonical Tahoe artifact (SAMPLE_NARRATION_QID,
the `emerald-bay-run` first tour, the deleted postcard), and the one Tahoe
silhouette a stranger recognises. The bay opens to the RIGHT into the main lake —
drawing it symmetrically turns it into a goblet, which the first pass did.

Run:  python3 gen.py            # day sheet + in-situ mocks
      python3 gen.py --dusk     # also render the dusk set
"""
import os
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

W, H = 1320, 2868  # iPhone 17 Pro Max @3x — matches the reference screenshot exactly

# ── Palette ────────────────────────────────────────────────────────────────────
# Lifted from src/theme/tokens.ts, not re-picked by eye. If these drift from the
# tokens the posters stop being in-system.
DAY = dict(
    paper="#F2E7CC", paperRaised="#FBF3DD", paperSunken="#E7D9B5",
    pine="#1E5B40", pineDeep="#15402F", amber="#DD7A33",
    ink="#2A2014", tan="#CDB988", teal="#2C6E7E",
    # ⚠ DOES NOT FLIP. The road lies on a dark plane in BOTH themes, so a
    # theme-flipping role is wrong for it: `paper` in dusk is #14201B, the night
    # BACKGROUND, and stroking the road with it drew dark-on-dark and the road
    # vanished. This is the live argument for theme.ts's `onPhoto` pair.
    road="#F2E7CC",
)
DUSK = dict(
    paper="#14201B", paperRaised="#1B2A23", paperSunken="#0D1712",
    pine="#2E6B4C", pineDeep="#1B3A2B", amber="#EBA351",
    ink="#ECE0C4", tan="#3A4A3E", teal="#2A5563",
    road="#F2E7CC",  # same value as day, deliberately — see the note above
)

# ── Where the UI actually sits (measured off coldopen.png) ────────────────────
# These are the whole reason the compositions look the way they do.
Z_HEADER = 300        # status bar + SKIPPER masthead
Z_CHIP = 520          # region chip / today's Ridgeline
Z_CARDS_TOP = 820     # five OPAQUE cards start
Z_CARDS_BOT = 2065    # ...and end. Nothing behind this band is visible.
Z_COMPOSER = 2570     # composer bar top
# => the only genuinely free paper is Z_CARDS_BOT..Z_COMPOSER (~500px) plus the
#    sky above the headline. Both are used deliberately below.


def conifer(cx, base, h, w, fill, op=1.0):
    """A stacked-triangle conifer. Three tiers reads as a tree; two reads as an
    arrowhead, four turns to mush at this scale. No trunk — at poster scale it is
    one pixel of noise and it broke the silhouette in the first pass."""
    p = []
    for fy, fw in ((0.00, 1.00), (0.30, 0.74), (0.58, 0.46)):
        y0 = base - h * fy
        top = base - h * (fy + 0.44)
        hw = w * fw / 2
        p.append(f"M{cx - hw:.1f},{y0:.1f} L{cx:.1f},{top:.1f} L{cx + hw:.1f},{y0:.1f} Z")
    return f'<path d="{" ".join(p)}" fill="{fill}" opacity="{op}"/>'


def band(pts, base, fill, op=1.0):
    """Close a run of (x,y) points down to `base` — the workhorse for every ridge,
    shoreline and slope here."""
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    d += f" L{pts[-1][0]:.1f},{base:.1f} L{pts[0][0]:.1f},{base:.1f} Z"
    return f'<path d="{d}" fill="{fill}" opacity="{op}"/>'


def base_paper(p):
    """⚠ ALWAYS FIRST. Round 1 shipped transparent holes below the waterline and
    PIL rendered them pure black in the contact sheet. Nothing here may rely on
    the app's own background showing through — the poster owns every pixel."""
    return f'<rect width="{W}" height="{H}" fill="{p["paper"]}"/>'


def emerald_bay(p, horizon, drama=1.0, sun=None, framing=False,
                foreground=True, land=None, water_to_bottom=False):
    """Emerald Bay, layered back-to-front. `horizon` is the far shoreline.

    ⚠ EVERY offset is a FRACTION OF `scene`, never an absolute pixel. Round 2
    found the bug that hides behind absolute values: geometry hand-tuned at a
    full-bleed horizon collapses to bumps when the horizon drops to the card
    line, so the low-horizon variants were being judged on a scene that had
    silently lost its mountains.
    """
    scene = H - horizon
    s = [base_paper(p)]
    land = land or p["pine"]

    if sun:
        # Amber is DECORATIVE and nowhere load-bearing: 2.63:1 on pine, 2.47:1 on
        # paper, under the 3:1 non-text bar on both (measured, icon round). A disc
        # only — a full radial burst reads as the Rising Sun flag.
        s.append(f'<circle cx="{W * .70:.0f}" cy="{horizon - scene * sun:.0f}" '
                 f'r="{scene * .085:.0f}" fill="{p["amber"]}"/>')

    def pk(f):
        return horizon - scene * f * drama

    # Far Sierra wall. Tan keeps it atmospheric; painting it in pine competes with
    # the near slopes and flattens the stack.
    far = [(0, pk(.20)), (W * .12, pk(.40)), (W * .22, pk(.25)), (W * .33, pk(.52)),
           (W * .45, pk(.29)), (W * .57, pk(.45)), (W * .68, pk(.23)), (W * .80, pk(.39)),
           (W * .91, pk(.21)), (W, pk(.34))]
    s.append(band(far, horizon + 4, p["tan"]))

    shore = horizon + scene * .42
    # ⚠ The water runs PAST the shoreline it meets. Round 1 ended it exactly at
    # `shore` while the near band's undulating top dipped below — so base paper
    # showed through as a cream sliver along the whole waterline.
    wb = H if water_to_bottom else shore + scene * .10
    s.append(f'<rect x="0" y="{horizon:.1f}" width="{W}" height="{wb - horizon:.1f}" fill="{p["teal"]}"/>')

    # Fannette Island — the detail that makes this Emerald Bay and not any lake.
    iy = horizon + scene * .22
    s.append(f'<ellipse cx="{W * .46:.0f}" cy="{iy:.0f}" rx="{scene * .036:.0f}" '
             f'ry="{scene * .013:.0f}" fill="{p["pineDeep"]}"/>')
    s.append(conifer(W * .46, iy, scene * .050, scene * .030, p["pineDeep"]))

    if not water_to_bottom:
        near = [(0, shore + scene * .04), (W * .16, shore), (W * .34, shore + scene * .05),
                (W * .52, shore + scene * .01), (W * .72, shore + scene * .06),
                (W * .88, shore + scene * .02), (W, shore + scene * .05)]
        s.append(band(near, H, land))

    # ASYMMETRIC on purpose — the real bay opens RIGHT into the main lake, so the
    # left arm reaches further and the right sits back. Symmetry made a goblet.
    left = [(0, pk(.06)), (W * .09, horizon + scene * .06), (W * .18, horizon + scene * .16),
            (W * .27, horizon + scene * .30), (W * .34, shore + scene * .05)]
    right = [(W, pk(.12)), (W * .94, horizon + scene * .04), (W * .87, horizon + scene * .13),
             (W * .79, horizon + scene * .26), (W * .74, shore + scene * .05)]
    s.append(band(left, H, land))
    s.append(band(right, H, land))

    if framing:
        for x, sc in ((.04, 1.0), (.11, .80), (.19, .62), (.96, 1.0), (.89, .82), (.81, .60)):
            s.append(conifer(W * x, horizon + scene * (.20 + .10 * (1 - sc)),
                             scene * .17 * sc, scene * .085 * sc, p["pineDeep"]))

    if foreground:
        # The near slope you stand on — an EDGE running off both sides, not an
        # object. Same argument that replaced the Sunburst with a Ridgeline.
        fy = H - scene * .22
        fg = [(0, fy + scene * .03), (W * .18, fy - scene * .04), (W * .34, fy + scene * .02),
              (W * .52, fy - scene * .03), (W * .70, fy + scene * .02),
              (W * .86, fy - scene * .035), (W, fy + scene * .01)]
        s.append(band(fg, H, p["pineDeep"]))
        for x, sc in ((.07, .95), (.22, 1.10), (.39, .84), (.57, 1.02), (.75, .90), (.91, 1.0)):
            s.append(conifer(W * x, fy + scene * .04, scene * .15 * sc, scene * .075 * sc, p["pineDeep"]))
    return "".join(s)



def ridges(p, top, layers=3, diagonal=0.0, sun=None, trees=False, wash=1.0, inks=None, foot=1.0, jag=1.0):
    """Layered ridge planes, NO water.

    ⚠ Round 2's finding, and the reason this function exists: a full bay scene
    compressed into the ~500px free band reads as STRIPES (cream / tan / teal /
    green), and the flat teal water plane is the loudest stripe. Overlapping
    ridges in three values of the same family survive compression because the
    thing being read is a SILHOUETTE, not a scene.

    `diagonal` tilts the whole stack — WPA's "diagonal movement", the one grammar
    note round 1 and 2 both ignored.
    """
    s = [base_paper(p)]
    span = H - top
    if sun:
        s.append(f'<circle cx="{W * .68:.0f}" cy="{top + span * sun:.0f}" '
                 f'r="{span * .17:.0f}" fill="{p["amber"]}" opacity="{wash}"/>')
    inks = inks or [p["tan"], p["pine"], p["pineDeep"]][-layers:]
    for i, ink in enumerate(inks):
        f = i / max(1, layers - 1)
        base_y = top + span * (0.30 + 0.34 * f)
        amp = span * (0.30 - 0.10 * f)
        pts = []
        for k in range(9):
            x = W * k / 8
            j = ((k * 7 + i * 5) % 6) / 5          # deterministic jag
            tilt = diagonal * span * (0.5 - k / 8)
            pts.append((x, base_y - amp * jag * (0.35 + 0.65 * j) + tilt))
        s.append(band(pts, top + (H - top) * foot if foot < 1 else H, ink, op=wash))
        if trees and i == layers - 1:
            for k, sc in ((.10, 1.0), (.27, .78), (.46, 1.12), (.66, .84), (.86, 1.0)):
                s.append(conifer(W * k, base_y + span * .30, span * .26 * sc,
                                 span * .12 * sc, ink, op=wash))
    return "".join(s)



def plane(p, top, span, i, layers, diagonal, ink):
    """One ridge plane. Split out of `ridges` so the lake can be drawn BETWEEN
    planes — depth here is pure overlap order, the way a silkscreen builds it."""
    f = i / max(1, layers - 1)
    base_y = top + span * (0.30 + 0.34 * f)
    pts = []
    for k in range(9):
        x = W * k / 8
        pts.append((x, base_y + diagonal * span * (0.5 - k / 8)))
    return band(pts, H, ink)


def road_pts(top, span, n=64):
    """A smooth winding ribbon, sampled as a polyline.

    ⚠ Round 5 drew this as 4 long straight switchback legs and it read as a
    LIGHTNING BOLT, not a road. A road bends; it does not zigzag at 60°. Sampling
    a curve also keeps the car placeable at any point along it, which a bezier
    `d` string does not.
    """
    import math
    out = []
    for k in range(n):
        t = k / (n - 1)
        y = top + span * (0.94 - 0.42 * t)
        x = W * (0.50 + 0.30 * math.sin(t * math.pi * 1.35 + 0.55) * (1 - 0.35 * t))
        out.append((x, y))
    return out


def car(p, pts, t=0.55, ink=None, sc=1.0):
    """The rig, as a readable silhouette.

    ⚠ Two failure modes already burned: (a) body + cabin + wheels drawn small MERGE
    into an orange blob; (b) wheels filled `pineDeep` on a `pineDeep` field read as
    HOLES BITTEN OUT of the car, not wheels. So the body sits ABOVE the road
    centreline and the wheels land inside the cream road stroke, where dark reads.
    """
    import math
    n = len(pts)
    i = max(2, min(n - 3, int(t * (n - 1))))
    cx, cy = pts[i]
    (x0, y0), (x1, y1) = pts[i - 2], pts[i + 2]
    ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
    k = ink or p["amber"]
    return (f'<g transform="translate({cx:.0f},{cy:.0f}) rotate({ang:.1f}) scale({sc})">'
            f'<circle cx="-19" cy="0" r="7.5" fill="{p["pineDeep"]}"/>'
            f'<circle cx="19" cy="0" r="7.5" fill="{p["pineDeep"]}"/>'
            f'<rect x="-33" y="-17" width="66" height="15" rx="5" fill="{k}"/>'
            f'<path d="M-16,-17 L-13,-29 Q-12,-31 -9,-31 L6,-31 Q9,-31 10,-29 L14,-17 Z" fill="{k}"/>'
            f'</g>')


def lake(p, cx, cy, w, h):
    """A shaped body of water, not an ellipse — and drawn UNDER the near ridge so
    it is partly occluded. That overlap is what makes it read as nestled IN the
    range instead of pasted ON it. ⚠ Never a full-width plane: round 2 proved flat
    teal spanning the screen is the loudest stripe in the composition."""
    d = (f"M{cx - w * .50:.0f},{cy:.0f} C{cx - w * .42:.0f},{cy - h * .62:.0f} "
         f"{cx - w * .10:.0f},{cy - h * .58:.0f} {cx + w * .12:.0f},{cy - h * .30:.0f} "
         f"C{cx + w * .34:.0f},{cy - h * .04:.0f} {cx + w * .52:.0f},{cy + h * .10:.0f} "
         f"{cx + w * .44:.0f},{cy + h * .34:.0f} C{cx + w * .30:.0f},{cy + h * .62:.0f} "
         f"{cx - w * .22:.0f},{cy + h * .60:.0f} {cx - w * .50:.0f},{cy:.0f} Z")
    return f'<path d="{d}" fill="{p["teal"]}"/>'



# ── Termini — "the drive should END with something, not just stop" ────────────
# ⚠ The road running off the right edge reads as STOPPING, not ARRIVING. The app
# icon already answers this: `../explore/gen5.py` ends its switchback S with an
# amber head dot ON the stroke. So a terminus is the icon's own grammar, not a
# new invention. Each of these sits at the road's last point.
# ⚠ AMBER BUDGET: the cold open carries no amber at all today, and DESIGN §8
# allows ONE amber GLOW. These are flat fills, never glows — and if the rig is
# amber, a second amber terminus is two warm objects competing. The `_pale`
# variants exist for exactly that reason.

def cabin(p, x, y, s=1.0, warm=True):
    """A gable-roof cabin with a lit window. Arrival, and somewhere to arrive AT."""
    w, h = 54 * s, 40 * s
    g = f'<g transform="translate({x:.0f},{y:.0f})">'
    g += f'<rect x="{-w / 2:.0f}" y="{-h:.0f}" width="{w:.0f}" height="{h:.0f}" fill="{p["road"]}"/>'
    g += (f'<path d="M{-w * .62:.0f},{-h:.0f} L0,{-h - 30 * s:.0f} L{w * .62:.0f},{-h:.0f} Z" '
          f'fill="{p["road"]}"/>')
    g += (f'<rect x="{-w * .17:.0f}" y="{-h * .72:.0f}" width="{w * .34:.0f}" height="{h * .40:.0f}" '
          f'fill="{p["amber"] if warm else p["pineDeep"]}"/>')
    return g + "</g>"


def signpost(p, x, y, s=1.0):
    """A carved ranger trail sign — DESIGN.md names these as a source reference."""
    g = f'<g transform="translate({x:.0f},{y:.0f})">'
    g += f'<rect x="{-3 * s:.0f}" y="{-62 * s:.0f}" width="{6 * s:.0f}" height="{62 * s:.0f}" fill="{p["road"]}"/>'
    for i, (dy, w) in enumerate(((-58, 46), (-40, 36))):
        g += (f'<path d="M{-4 * s:.0f},{dy * s:.0f} L{w * s:.0f},{dy * s:.0f} '
              f'L{(w + 9) * s:.0f},{(dy + 7) * s:.0f} L{w * s:.0f},{(dy + 14) * s:.0f} '
              f'L{-4 * s:.0f},{(dy + 14) * s:.0f} Z" fill="{p["road"]}"/>')
    return g + "</g>"


def lookout(p, x, y, s=1.0, warm=True):
    """A fire lookout on legs — the thing at the end of a mountain road."""
    g = f'<g transform="translate({x:.0f},{y:.0f})">'
    for dx in (-17, 17):
        g += (f'<path d="M{dx * s:.0f},0 L{dx * .55 * s:.0f},{-46 * s:.0f} '
              f'l{6 * s:.0f},0 L{(dx + 6) * s:.0f},0 Z" fill="{p["road"]}"/>')
    g += f'<rect x="{-26 * s:.0f}" y="{-72 * s:.0f}" width="{52 * s:.0f}" height="{28 * s:.0f}" fill="{p["road"]}"/>'
    g += (f'<path d="M{-32 * s:.0f},{-72 * s:.0f} L0,{-92 * s:.0f} L{32 * s:.0f},{-72 * s:.0f} Z" '
          f'fill="{p["road"]}"/>')
    g += (f'<rect x="{-13 * s:.0f}" y="{-66 * s:.0f}" width="{26 * s:.0f}" height="{15 * s:.0f}" '
          f'fill="{p["amber"] if warm else p["pineDeep"]}"/>')
    return g + "</g>"


def marker(p, x, y, s=1.0):
    """The icon's amber head dot, lifted verbatim — a ringed disc ON the road."""
    return (f'<g transform="translate({x:.0f},{y:.0f})">'
            f'<circle cx="0" cy="0" r="{20 * s:.0f}" fill="{p["road"]}"/>'
            f'<circle cx="0" cy="0" r="{13 * s:.0f}" fill="{p["amber"]}"/></g>')


TERMINI = {"cabin": cabin, "signpost": signpost, "lookout": lookout, "marker": marker,
           "cabin_pale": lambda p, x, y, s=1.0: cabin(p, x, y, s, warm=False),
           "lookout_pale": lambda p, x, y, s=1.0: lookout(p, x, y, s, warm=False),
           "none": None}


def poster(p, diagonal=0.16, with_lake=True, with_road=True, car_t=0.52,
           car_ink=None, road_w=22, top=None, lake_x=0.20, car_scale=1.0,
           lake_up=235, lake_w=0.28, lake_h=105,
           wiggle=0.10, bends=1.9, road_end=0.94, terminus=None, term_scale=1.0):
    """The candidate, positioned in ABSOLUTE screen coordinates.

    ⚠ Round 6's lesson: the readable strip is Z_CARDS_BOT..Z_COMPOSER, about 505px
    of a 2868px screen. Three planes + a lake + a road + a car do not fit in it —
    round 6 tried and the lake became a blue DOME (occluded to just its crown) and
    the road shrank to a thread under the composer. So the elements are placed
    against real y values here, not fractions of a span that silently rescale.
    """
    top = Z_CARDS_BOT if top is None else top
    s = [base_paper(p)]
    inks = [p["tan"], p["pine"], p["pineDeep"]]
    # Ridges live in the TOP 45% of the strip; the road owns the rest.
    for i, ink in enumerate(inks):
        y = top + (Z_COMPOSER - top) * (0.10 + 0.17 * i)
        pts = [(W * k / 8, y + diagonal * (Z_COMPOSER - top) * (0.5 - k / 8)) for k in range(9)]
        s.append(band(pts, H, ink))

    if with_lake:
        # ⚠ On the NEAR field, fully visible. Rounds 6-7 put it on the far plane
        # where the next ridge clipped it to its crown and it read as a blue HILL.
        # A small lake you can see beats a big one you cannot.
        s.append(lake(p, W * lake_x, Z_COMPOSER - lake_up, W * lake_w, lake_h))
    if with_road:
        import math
        y0, y1 = Z_COMPOSER - 30, top + (Z_COMPOSER - top) * 0.52
        pts = []
        for k in range(72):
            t = k / 71
            # ⚠ `bends`/`wiggle` stay MODEST and stay a SINE. Round 5 drew this as
            # straight switchback legs and it read as a lightning bolt; the cure is
            # more curvature, never more angle.
            # ⚠ The wiggle is ENVELOPED by sin(pi*t) so it vanishes at t=0 and t=1.
            # Without it the sine was still at 0.95 when the road ended, so
            # `road_end` never controlled the endpoint and every terminus got
            # shoved against the right edge of the canvas.
            pts.append((W * (0.07 + (road_end - 0.07) * t
                             + wiggle * math.sin(t * math.pi * bends) * math.sin(t * math.pi)),
                        y0 - (y0 - y1) * t))
        d = "M" + " L".join(f"{x:.0f},{y:.0f}" for x, y in pts)
        s.append(f'<path d="{d}" fill="none" stroke="{p["road"]}" stroke-width="{road_w}" '
                 f'stroke-linecap="round" stroke-linejoin="round"/>')
        s.append(f'<path d="{d}" fill="none" stroke="{p["pineDeep"]}" stroke-width="{road_w * .18:.1f}" '
                 f'stroke-linecap="round" stroke-dasharray="{road_w * .8:.0f} {road_w:.0f}" opacity="0.5"/>')
        s.append(car(p, pts, car_t, car_ink, car_scale))
        fn = TERMINI.get(terminus)
        if fn:
            ex, ey = pts[-1]
            s.append(fn(p, ex, ey - 4, term_scale))
    return "".join(s)


# ⚠ `car_t` is not free: at 0.34 the rig sits exactly on the steep bend and
# rotates broadside, which reads as an orange CROSS on the road. 0.60 is a flat
# stretch. If the road's wiggle changes, re-check where the flat parts are.
VARIANTS = [
    ("D1-cabin", "Cabin. Gentle zig. The recommendation.",
     lambda p: poster(p, car_scale=1.0, car_t=0.60, road_w=26, terminus="cabin",
                      term_scale=1.5, wiggle=0.13, bends=2.6, road_end=0.84)),
    ("D2-zig", "Cabin, more zig — the founder's 'just a tad', upper bound.",
     lambda p: poster(p, car_scale=1.0, car_t=0.60, road_w=26, terminus="cabin",
                      term_scale=1.5, wiggle=0.19, bends=3.4, road_end=0.84)),
    ("D3-signpost", "Ranger signpost instead of a cabin.",
     lambda p: poster(p, car_scale=1.0, car_t=0.60, road_w=26, terminus="signpost",
                      term_scale=1.5, wiggle=0.13, bends=2.6, road_end=0.84)),
    ("D4-lookout", "Fire lookout instead.",
     lambda p: poster(p, car_scale=1.0, car_t=0.60, road_w=26, terminus="lookout",
                      term_scale=1.4, wiggle=0.13, bends=2.6, road_end=0.84)),
    ("D5-marker", "The icon's amber head dot.",
     lambda p: poster(p, car_scale=1.0, car_t=0.60, road_w=26, terminus="marker",
                      term_scale=1.6, wiggle=0.13, bends=2.6, road_end=0.84)),
    ("D6-pale", "Pale cabin — the rig keeps the only amber on the screen.",
     lambda p: poster(p, car_scale=1.0, car_t=0.60, road_w=26, terminus="cabin_pale",
                      term_scale=1.5, wiggle=0.13, bends=2.6, road_end=0.84)),
    ("D7-calm", "Cabin, barely any zig — lower bound.",
     lambda p: poster(p, car_scale=1.0, car_t=0.60, road_w=26, terminus="cabin",
                      term_scale=1.5, wiggle=0.07, bends=1.9, road_end=0.84)),
    ("D8-none", "No terminus — the control the founder asked to move away from.",
     lambda p: poster(p, car_scale=1.0, car_t=0.60, road_w=26, wiggle=0.13, bends=2.6)),
]


def svg(body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
            f'viewBox="0 0 {W} {H}">{body}</svg>')


def render(name, body):
    sp, pp = os.path.join(OUT, name + ".svg"), os.path.join(OUT, name + ".png")
    with open(sp, "w") as f:
        f.write(svg(body))
    subprocess.run(["rsvg-convert", "-w", str(W), "-h", str(H), sp, "-o", pp], check=True)
    return pp


def ui_overlay(shot_path, paper_hex, tol=10):
    """The real cold open with its PAPER knocked out, so a poster sits behind the
    ACTUAL cards and text instead of a reconstruction of them.

    Keys ONLY the flat base paper — `paperRaised` cards, ink, the chip and the
    composer all survive, which is exactly the occlusion we need to see.
    """
    im = Image.open(shot_path).convert("RGBA").resize((W, H))
    tr = tuple(int(paper_hex[i:i + 2], 16) for i in (1, 3, 5))
    px = im.load()
    for y in range(H):
        for x in range(W):
            r, g, b, _ = px[x, y]
            if abs(r - tr[0]) <= tol and abs(g - tr[1]) <= tol and abs(b - tr[2]) <= tol:
                px[x, y] = (r, g, b, 0)
    return im


def sheet(paths, path, cols=4, tile_w=330):
    tile_h = int(tile_w * H / W)
    rows = (len(paths) + cols - 1) // cols
    pad = 14
    sh = Image.new("RGB", (cols * (tile_w + pad) + pad, rows * (tile_h + pad) + pad), (28, 28, 28))
    for i, p in enumerate(paths):
        im = Image.open(p).convert("RGB").resize((tile_w, tile_h))
        c, r = i % cols, i // cols
        sh.paste(im, (pad + c * (tile_w + pad), pad + r * (tile_h + pad)))
    sh.save(path)
    print(f"  -> {os.path.basename(path)} ({len(paths)} tiles)")


def main():
    do_dusk = "--dusk" in sys.argv

    for pal, tag in ((DAY, "day"), (DUSK, "dusk")) if do_dusk else ((DAY, "day"),):
        bare, insitu = [], []
        shot_t = os.path.join(HERE, "coldopen.png" if tag == "day" else "coldopen-dusk.png")
        overlay = ui_overlay(shot_t, pal["paper"]) if os.path.exists(shot_t) else None
        for name, note, fn in VARIANTS:
            p = render(f"{tag}-{name}", fn(pal))
            bare.append(p)
            if overlay is not None:
                m = Image.open(p).convert("RGBA")
                m.alpha_composite(overlay)
                mp = os.path.join(OUT, f"{tag}-{name}-insitu.png")
                m.convert("RGB").save(mp)
                insitu.append(mp)
            print(f"  {tag}-{name}: {note}")
        sheet(bare, os.path.join(HERE, f"sheet-{tag}.png"))
        if insitu:
            sheet(insitu, os.path.join(HERE, f"sheet-{tag}-insitu.png"))


if __name__ == "__main__":
    main()
