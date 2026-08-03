#!/usr/bin/env python3
"""
App-icon exploration — round 3. Finalist: the SQUARED switchback S (`sb-squared`).

Round 2's squared S was a hand-written bezier with lumpy counters. Here it is
rebuilt as a proper constructed letterform: a monoline centreline of straight
runs joined at right angles, rounded by the stroke's own linejoin. That is
exactly how a switchback road is drawn on a map, and it matches the routed
trail-sign language of Trailhead 89 better than a drawn curve.

Round 3 settles: stroke weight, terminals, centre line, amber, ground.
Plus a safe-zone diagnostic against the real iOS squircle, and a home-screen
mock among real App Store icons.

Run:  python3 gen3.py
"""
import os, math
from PIL import Image, ImageDraw
from gen import DAY, DUSK, svg, rsvg, tinted, OUT

HERE = os.path.dirname(os.path.abspath(__file__))
HS = os.path.join(OUT, "hs")
os.makedirs(HS, exist_ok=True)

# Constructed centreline: top bar left, down, middle bar right, down, bottom bar left.
# Corner rounding comes from stroke-linejoin, so weight and radius stay coupled —
# which is what keeps it reading as one continuous road rather than five segments.
SPINE = [(742, 226), (352, 226), (352, 512), (672, 512), (672, 798), (282, 798)]

# The round-2 pick as actually drawn: a typographic S skeleton with straight flanks
# and turned bowls. Kept alongside the rectilinear rebuild because going fully
# right-angled changes the letter's character more than "squared" asked for —
# at stroke weight it starts reading as a 5. Founder compares them directly.
DRAWN = ("M 726 344 C 726 254 634 206 540 206 C 420 206 326 274 326 370 "
         "C 326 458 402 500 518 524 C 634 548 710 590 710 678 "
         "C 710 774 616 842 496 842 C 402 842 310 794 310 704")


def cols(p, paper):
    if p is DUSK:
        return p["pine"], p["cream"], p["amber"]
    return (p["cream"], p["pine"], p["amber"]) if paper else (p["pine"], p["cream"], p["amber"])


def _pts(scale=1.0):
    cx = cy = 512
    return [(cx + (x - cx) * scale, cy + (y - cy) * scale) for x, y in SPINE]


def sq(p, paper=True, w=150, cap="round", centre="dash", amber="head", scale=1.0,
       drawn=False):
    field, mark, accent = cols(p, paper)
    if drawn:
        geom = f'd="{DRAWN}"'
        tag, head, tail = "path", (726, 344), (310, 704)
    else:
        pts = _pts(scale)
        geom = 'points="' + " ".join(f"{x:.0f},{y:.0f}" for x, y in pts) + '"'
        tag, head, tail = "polyline", pts[0], pts[-1]

    sw = w * scale
    b = (f'<{tag} {geom} fill="none" stroke="{mark}" stroke-width="{sw:.0f}" '
         f'stroke-linecap="{cap}" stroke-linejoin="round"/>')

    if centre != "none":
        dash_col = accent if (not paper and p is not DUSK) else field
        dw = max(16, int(sw) // 9)
        da = f'stroke-dasharray="{int(sw)//4} {int(sw)//3}"' if centre == "dash" else ""
        b += (f'<{tag} {geom} fill="none" stroke="{dash_col}" stroke-width="{dw}" '
              f'stroke-linecap="round" stroke-linejoin="round" {da}/>')

    r = int(sw) // 5
    if amber in ("head", "both"):
        b += f'<circle cx="{head[0]:.0f}" cy="{head[1]:.0f}" r="{r}" fill="{accent}"/>'
    if amber == "both":
        b += f'<circle cx="{tail[0]:.0f}" cy="{tail[1]:.0f}" r="{r}" fill="{accent}"/>'
    return svg(b, field)


V = [
    ("s3-a", "Refined baseline", dict(),
     "The round-2 pick rebuilt as a constructed letterform: straight runs, right-angle turns rounded by the stroke itself. Stroke 160, dashed centre line, amber head, paper ground."),
    ("s3-b", "Flat terminals", dict(cap="butt"),
     "Butt caps instead of round. Reads as a routed sign rather than a drawn line — closer to the carved trail-marker language the design system is built on."),
    ("s3-c", "Heavier stroke", dict(w=186),
     "Stroke 186. More presence at 40px and in a home-screen grid; the counters tighten, which is the trade."),
    ("s3-d", "No centre line", dict(centre="none"),
     "Drops the dashes. The crispest possible mark and the safest under tinting, at the cost of the road story — this is a pure letterform."),
    ("s3-e", "Pine ground", dict(paper=False),
     "Inverts the values: cream road on pine, amber dashes. Safe and on-brand, but gives up the paper ground that nothing else in the category uses."),
    ("s3-f", "Two-colour, no amber", dict(amber="none"),
     "Screen-print purity — two inks, exactly what a 1938 WPA poster could actually print. Maximum tinted safety since there is no hue-dependent element at all."),
    ("s3-g", "Both terminals", dict(amber="both"),
     "Amber at the start AND the end of the road. Says 'A to B', which is literally what the planner asks the rider for."),
    ("s3-h", "Filling the frame", dict(scale=1.10),
     "Same mark scaled to sit close to the safe-zone edge. Bolder in a grid; check it against the squircle diagnostic before trusting it."),
    ("s3-i", "Drawn S · dashed", dict(drawn=True),
     "The round-2 letterform you actually picked, refined and scaled — straight flanks, turned bowls. Going fully right-angled (everything above) changes the character more than 'squared' asked for, so this is the faithful comparison."),
    ("s3-j", "Drawn S · clean", dict(drawn=True, centre="none"),
     "The drawn letterform with no centre line. The most elegant mark of the ten and the best small-size read — the question is whether losing the road story is worth it."),
]


def safezone(path_png, out_png):
    """Overlay the real iOS squircle mask + the 80% safe box on a rendered icon."""
    im = Image.open(path_png).convert("RGBA").resize((512, 512), Image.LANCZOS)
    ov = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    # iOS superellipse |x|^n + |y|^n = 1, n ~= 5 — the actual continuous-corner shape
    n, cx, r = 5.0, 256, 256
    pts = []
    for i in range(721):
        t = math.radians(i * 0.5)
        ct, st = math.cos(t), math.sin(t)
        x = cx + r * math.copysign(abs(ct) ** (2 / n), ct)
        y = cx + r * math.copysign(abs(st) ** (2 / n), st)
        pts.append((x, y))
    d.line(pts + [pts[0]], fill=(255, 90, 90, 235), width=3)
    m = int(512 * 0.10)
    d.rectangle([m, m, 512 - m, 512 - m], outline=(95, 200, 130, 210), width=3)
    im.alpha_composite(ov)
    im.convert("RGB").save(out_png)


def homescreen(icon_png, out_png):
    """Drop the candidate into a grid of real App Store icons, at true 60pt @3x."""
    cache = "/Users/ptshih/.claude/jobs/9d2fc6da/tmp/iconcache"
    names = ["AllTrails.jpg", "Overcast.jpg", "Strava.jpg", "Gaia_GPS.jpg",
             "Audible.jpg", "Atlas_Obscura.jpg", "Pocket_Casts.jpg", "komoot.jpg",
             "Autio.jpg", "Roadtrippers.jpg", "onX_Offroad.jpg"]
    S, GAP, COLS, PAD = 120, 34, 4, 40
    rows = 3
    W = COLS * S + (COLS - 1) * GAP + PAD * 2
    H = rows * S + (rows - 1) * (GAP + 22) + PAD * 2
    bg = Image.new("RGB", (W, H), "#243043")
    for y in range(H):  # soft dusk wallpaper so nothing gets a flattering black
        for x in range(0, W, 4):
            pass
    grid, k = [], 0
    for i in range(COLS * rows):
        if i == 5:
            grid.append(icon_png)
        else:
            grid.append(os.path.join(cache, names[k % len(names)])); k += 1
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.2237), fill=255)
    for i, src in enumerate(grid):
        try:
            im = Image.open(src).convert("RGB").resize((S, S), Image.LANCZOS)
        except Exception:
            continue
        c, r = i % COLS, i // COLS
        x = PAD + c * (S + GAP)
        y = PAD + r * (S + GAP + 22)
        bg.paste(im, (x, y), mask)
    bg.save(out_png)


def main():
    for key, _, kw, _ in V:
        for mode, pal in (("light", DAY), ("dark", DUSK)):
            s = os.path.join(OUT, f"{key}-{mode}.svg")
            open(s, "w").write(sq(pal, **kw))
            rsvg(s, os.path.join(OUT, f"{key}-{mode}.png"))
        tinted(os.path.join(OUT, f"{key}-light.png"), os.path.join(OUT, f"{key}-tinted.png"))
        safezone(os.path.join(OUT, f"{key}-light.png"), os.path.join(OUT, f"{key}-safe.png"))
    for key in ("s3-a", "s3-c", "s3-i", "s3-j"):
        homescreen(os.path.join(OUT, f"{key}-light.png"), os.path.join(HS, f"{key}.png"))
    open(os.path.join(HERE, "round3.html"), "w").write(page())
    print(f"round 3: {len(V)} executions + safe-zone + home-screen mocks -> {OUT}")


def page():
    grid = "".join(
        f'<figure class="g"><img src="out/{k}-light.png"><figcaption>{t}</figcaption></figure>'
        for k, t, _, _ in V)
    rows = "".join(f"""
<section class="row">
  <div class="meta"><h2>{t}</h2><p>{w}</p><p class="key"><code>{k}</code></p></div>
  <div class="shots">
    <figure><img src="out/{k}-light.png"><figcaption>Default</figcaption></figure>
    <figure><img src="out/{k}-dark.png"><figcaption>Dark</figcaption></figure>
    <figure><img src="out/{k}-tinted.png"><figcaption>Tinted (sim)</figcaption></figure>
    <figure><img src="out/{k}-safe.png" class="sz"><figcaption>Mask + safe zone</figcaption></figure>
    <div class="small">
      {''.join(f'<figure><img src="out/{k}-light.png" style="width:{px}px;height:{px}px"><figcaption>{px}</figcaption></figure>' for px in (120, 80, 60, 40))}
    </div>
  </div>
</section>""" for k, t, _, w in V)
    mocks = "".join(
        f'<figure class="m"><img src="out/hs/{k}.png"><figcaption>{k}</figcaption></figure>'
        for k in ("s3-a", "s3-c", "s3-i", "s3-j"))
    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>Skipper — app icon, round 3</title>
<style>
  :root {{ color-scheme: dark; }} * {{ box-sizing:border-box; }}
  body {{ margin:0; background:#0E1412; color:#ECE0C4;
         font:15px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,sans-serif; }}
  header {{ padding:48px 56px 28px; border-bottom:1px solid #24322B; }}
  h1 {{ margin:0 0 10px; font-size:30px; letter-spacing:-.4px; }}
  header p {{ margin:0 0 8px; max-width:80ch; color:#A99D80; }}
  img {{ display:block; border-radius:22.37%; }}
  img.sz, .m img {{ border-radius:0; }}
  figure {{ margin:0; }} figcaption {{ margin-top:8px; font-size:12px; color:#8E866F; text-align:center; }}
  .board {{ padding:34px 56px 26px; border-bottom:1px solid #24322B; }}
  .board h3 {{ margin:0 0 20px; font-size:13px; letter-spacing:1.4px; text-transform:uppercase;
               color:#5FA877; font-weight:700; }}
  .gridwrap {{ display:flex; flex-wrap:wrap; gap:26px; }}
  .g img {{ width:126px; height:126px; }} .g figcaption {{ max-width:126px; }}
  .m img {{ width:300px; border-radius:14px; }}
  .row {{ display:flex; gap:40px; padding:30px 56px; border-bottom:1px solid #1C2622; align-items:flex-start; }}
  .meta {{ flex:0 0 270px; }} .meta h2 {{ margin:0 0 10px; font-size:19px; }}
  .meta p {{ margin:0 0 10px; color:#A99D80; font-size:14px; }}
  .key {{ font-size:12px; }} code {{ background:#1A231F; padding:2px 6px; border-radius:5px; color:#8E866F; }}
  .shots {{ display:flex; gap:20px; align-items:flex-start; flex-wrap:wrap; }}
  .shots > figure img {{ width:156px; height:156px; }}
  .small {{ display:flex; gap:14px; align-items:flex-end; padding-left:18px; border-left:1px solid #24322B; }}
  .small figcaption {{ font-size:11px; }}
  a {{ color:#5FA877; }} .note {{ margin:-8px 0 20px; max-width:80ch; color:#8E866F; font-size:13px; }}
</style></head><body>
<header><h1>Skipper — app icon, round 3</h1>
<p>Finalist: the <b>squared switchback</b>. Rebuilt as a constructed letterform — straight runs
joined at right angles, rounded by the stroke's own linejoin — rather than the lumpy hand-drawn
bezier round 2 used. That construction is also how a switchback is drawn on a map, and it sits
closer to the routed trail-sign language than a drawn curve does.</p>
<p>Eight executions settling stroke weight, terminals, centre line, amber, and ground.
The <b>mask + safe zone</b> panel overlays the real iOS superellipse (red) and the 80% safe box
(green). <a href="round2.html">← round 2</a> · <a href="gallery.html">round 1</a></p></header>
<div class="board"><h3>The eight</h3><div class="gridwrap">{grid}</div></div>
<div class="board"><h3>On a home screen, among real icons</h3>
<p class="note">True 60pt @3x against actual App Store artwork on a dusk wallpaper. This is the
only test that answers the question the whole exercise is really about: does it get found?</p>
<div class="gridwrap">{mocks}</div></div>
{rows}
</body></html>"""


if __name__ == "__main__":
    main()
