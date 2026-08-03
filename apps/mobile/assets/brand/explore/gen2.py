#!/usr/bin/env python3
"""
App-icon exploration — round 2.

Founder narrowed round 1 to three ROAD marks: switchback / vanishing / roadwave.
Four real executions of each, varying the things that actually decide it:
stroke weight, centre line, field colour, and (for roadwave) whether the
waveform can be made to read as a road at all.

Round-1 finding this is built against: iOS 26 derives tinted/clear by LUMINANCE,
so amber-on-pine and amber-on-cream both collapse. Amber must be decorative,
never load-bearing. Several executions below test exactly that.

Run:  python3 gen2.py
"""
import math, os, subprocess
from gen import DAY, DUSK, svg, rsvg, tinted, OUT

HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)


def cols(p, paper):
    """field, mark, accent — dusk always grounds on night-pine so the set stays a family."""
    if p is DUSK:
        return p["pine"], p["cream"], p["amber"]
    return (p["cream"], p["pine"], p["amber"]) if paper else (p["pine"], p["cream"], p["amber"])


# ── SWITCHBACK ────────────────────────────────────────────────────────────────
S_WIDE = "M 690 328 A 192 192 0 1 0 512 520 A 192 192 0 1 1 334 712"
S_TIGHT = ("M 700 336 C 700 262 622 226 540 226 C 428 226 356 288 356 372 "
           "C 356 452 424 490 528 512 C 632 534 700 572 700 652 "
           "C 700 736 628 798 516 798 C 434 798 356 762 356 688")


def sb(p, paper=True, dashes=True, path=S_WIDE, w=172, dot=True):
    field, mark, accent = cols(p, paper)
    b = f'<path d="{path}" fill="none" stroke="{mark}" stroke-width="{w}" ' \
        f'stroke-linecap="round" stroke-linejoin="round"/>'
    if dashes:
        dash_col = accent if (p is not DUSK and not paper) else field
        b += f'<path d="{path}" fill="none" stroke="{dash_col}" stroke-width="{max(16, w // 8)}" ' \
             f'stroke-linecap="round" stroke-dasharray="{w // 4} {w // 3}"/>'
    if dot:
        x, y = path.split()[1], path.split()[2]
        b += f'<circle cx="{x}" cy="{y}" r="{w // 5}" fill="{accent}"/>'
    return svg(b, field)


# ── VANISHING POINT ───────────────────────────────────────────────────────────
def _bez(p0, p1, p2, p3, n=90):
    return [(
        (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0],
        (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1],
    ) for t in (i / n for i in range(n + 1))]


def vp(p, paper=False, curve=False, sun="amber", dashes="field", gap=False):
    """gap=True lifts the road clear of the sun — without it the two cream shapes
    fuse and the whole thing reads as a KEYHOLE, which killed a round-1 concept."""
    field, mark, accent = cols(p, paper)
    sun_cy, sun_r = (340, 190) if gap else (368, 196)
    sun_fill = accent if sun == "amber" else mark
    rim = (f'<circle cx="512" cy="{sun_cy}" r="{sun_r + 26}" fill="{accent}"/>'
           if sun == "cream" else "")
    dash_col = {"field": field, "amber": accent, "mark": mark}[dashes]
    top = 610 if gap else 436

    if curve:
        pts = _bez((548, 470), (516, 690), (452, 806), (300, 1024))
        left, right = [], []
        for i, (x, y) in enumerate(pts):
            hw = (34 + 300 * (i / (len(pts) - 1)) ** 1.35) / 2
            left.append((x - hw, y))
            right.append((x + hw, y))
        poly = " ".join(f"{x:.0f},{y:.0f}" for x, y in left + list(reversed(right)))
        road = f'<polygon points="{poly}" fill="{mark}"/>'
        centre = ('<polyline points="' +
                  " ".join(f"{x:.0f},{y:.0f}" for x, y in pts) +
                  f'" fill="none" stroke="{dash_col}" stroke-width="24" '
                  'stroke-dasharray="46 64" stroke-linecap="round"/>')
    else:
        road = f'<path d="M 176 1024 L 454 {top} L 570 {top} L 848 1024 Z" fill="{mark}"/>'
        centre = (f'<path d="M 512 {top + 34} L 512 1024" fill="none" stroke="{dash_col}" '
                  'stroke-width="26" stroke-dasharray="54 74" stroke-linecap="round"/>')

    return svg(f'{rim}<circle cx="512" cy="{sun_cy}" r="{sun_r}" fill="{sun_fill}"/>'
               f'{road}{centre}', field)


# ── ROAD WAVE ─────────────────────────────────────────────────────────────────
def _wave_pts(horizontal=True, amp=176, envelope=False, n=180):
    """Centreline: straight lead-in, a talking section, straight lead-out."""
    a0, a1 = 0.24, 0.76
    pts = []
    for i in range(n + 1):
        t = i / n
        if t < a0 or t > a1:
            off = 0.0
        else:
            u = (t - a0) / (a1 - a0)
            env = math.sin(u * math.pi) ** 0.55 if not envelope else math.sin(u * math.pi) ** 1.6
            off = math.sin(u * 2 * math.pi) * amp * env
        if horizontal:
            pts.append((96 + t * 832, 512 - off))
        else:
            pts.append((512 + off, 968 - t * 832))
    return pts


def _poly(pts):
    return " ".join(f"{x:.0f},{y:.0f}" for x, y in pts)


def rw(p, paper=False, horizontal=True, envelope=False, ribbon=False, w=88):
    field, mark, accent = cols(p, paper)
    pts = _wave_pts(horizontal, envelope=envelope)
    if ribbon:
        # fake perspective: the road widens toward the viewer (bottom of frame)
        left, right = [], []
        for i, (x, y) in enumerate(pts):
            t = i / (len(pts) - 1)
            hw = (46 + 118 * (1 - t)) / 2 if not horizontal else (46 + 118 * t) / 2
            dx, dy = (0, 1) if horizontal else (1, 0)
            left.append((x - dx * hw * 0 - (hw if not horizontal else 0),
                         y - (hw if horizontal else 0)))
            right.append((x + (hw if not horizontal else 0),
                          y + (hw if horizontal else 0)))
        poly = _poly(left) + " " + _poly(list(reversed(right)))
        body = f'<polygon points="{poly}" fill="{mark}"/>'
    else:
        body = (f'<polyline points="{_poly(pts)}" fill="none" stroke="{mark}" '
                f'stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')
    centre = (f'<polyline points="{_poly(pts)}" fill="none" stroke="{field}" '
              f'stroke-width="{18 if not ribbon else 16}" stroke-linecap="round" '
              f'stroke-linejoin="round" stroke-dasharray="34 48"/>')
    ends = ""
    if not ribbon:
        (x0, y0), (x1, y1) = pts[0], pts[-1]
        ends = (f'<circle cx="{x0:.0f}" cy="{y0:.0f}" r="{w//2 - 6}" fill="{accent}"/>'
                f'<circle cx="{x1:.0f}" cy="{y1:.0f}" r="{w//2 - 6}" fill="{accent}"/>')
    return svg(body + centre + ends, field)


# ── the twelve ────────────────────────────────────────────────────────────────
V = [
    ("sb-bold", "Switchback · bold, paper", lambda p: sb(p),
     "Round 1 geometry scaled up to fill the frame, stroke 172, dashed centre line, amber head. The safe refinement."),
    ("sb-clean", "Switchback · no centre line", lambda p: sb(p, dashes=False),
     "Drops the dashes entirely. Pure letterform — the cleanest 40px and tinted read in the whole exploration, at the cost of the road story."),
    ("sb-pine", "Switchback · pine ground", lambda p: sb(p, paper=False),
     "Inverts the value structure: cream road on pine, amber dashes. Tests whether the paper ground is actually doing the work."),
    ("sb-tight", "Switchback · squared", lambda p: sb(p, path=S_TIGHT, w=150),
     "A squarer, more constructed S — closer to a routed highway-sign letterform than a drawn curve. Less friendly, more built."),

    ("vp-pine", "Vanishing · pine ground", lambda p: vp(p),
     "Round 1 refined. The cinematic open-road read, strongest of the three at conveying 'a drive'."),
    ("vp-paper", "Vanishing · paper ground", lambda p: vp(p, paper=True),
     "The paper strategy applied to the strongest composition — pine road on cream, which nobody in the category is doing."),
    ("vp-curve", "Vanishing · with a bend", lambda p: vp(p, curve=True),
     "Fixes the one real flaw: a dead-straight road reads as a beam of light. A bend reads as a road and adds motion."),
    ("vp-safe", "Vanishing · tinted-safe", lambda p: vp(p, sun="cream", dashes="amber", gap=True),
     "Amber demoted to a corona and the centre dashes, where it sits on cream instead of pine — the only pairing that survives luminance-only tinting. The road is lifted clear of the sun so the two cream shapes can't fuse into a keyhole."),

    ("rw-centre", "Road Wave · centre line", lambda p: rw(p),
     "The key fix: a dashed centre line makes the wiggle unmistakably a ROAD, so the waveform shape can carry the 'voice' meaning instead of reading as a chart."),
    ("rw-vert", "Road Wave · vertical", lambda p: rw(p, horizontal=False),
     "Rotated so the road climbs the frame. Uses the vertical space a horizontal line wastes, and reads more like travel than a graph."),
    ("rw-burst", "Road Wave · burst envelope", lambda p: rw(p, envelope=True),
     "Amplitude swells then settles — quiet road, he talks, quiet road. The most literal statement of what the product does."),
    ("rw-ribbon", "Road Wave · perspective ribbon", lambda p: rw(p, horizontal=False, ribbon=True),
     "The wave widens toward the viewer, so it is a road in perspective first and a waveform second. Most ambitious, most likely to mush small."),
]


def main():
    for key, _, fn, _ in V:
        for mode, pal in (("light", DAY), ("dark", DUSK)):
            s = os.path.join(OUT, f"{key}-{mode}.svg")
            open(s, "w").write(fn(pal))
            rsvg(s, os.path.join(OUT, f"{key}-{mode}.png"))
        tinted(os.path.join(OUT, f"{key}-light.png"), os.path.join(OUT, f"{key}-tinted.png"))
    open(os.path.join(HERE, "round2.html"), "w").write(page())
    print(f"round 2: {len(V)} executions -> {OUT}")


def page():
    groups = {"sb": "Switchback S", "vp": "Vanishing Point", "rw": "Road Wave"}
    out = []
    for pre, title in groups.items():
        items = [v for v in V if v[0].startswith(pre)]
        grid = "".join(
            f'<figure class="g"><img src="out/{k}-light.png"><figcaption>{t.split("·")[-1].strip()}</figcaption></figure>'
            for k, t, _, _ in items
        )
        rows = "".join(f"""
<section class="row">
  <div class="meta"><h2>{t}</h2><p>{w}</p><p class="key"><code>{k}</code></p></div>
  <div class="shots">
    <figure><img src="out/{k}-light.png"><figcaption>Default</figcaption></figure>
    <figure><img src="out/{k}-dark.png"><figcaption>Dark</figcaption></figure>
    <figure><img src="out/{k}-tinted.png"><figcaption>Tinted (sim)</figcaption></figure>
    <div class="small">
      {''.join(f'<figure><img src="out/{k}-light.png" style="width:{px}px;height:{px}px"><figcaption>{px}</figcaption></figure>' for px in (120, 80, 60, 40))}
    </div>
  </div>
</section>""" for k, t, _, w in items)
        out.append(f'<div class="board"><h3>{title}</h3><div class="gridwrap">{grid}</div></div>{rows}')
    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>Skipper — app icon, round 2</title>
<style>
  :root {{ color-scheme: dark; }} * {{ box-sizing:border-box; }}
  body {{ margin:0; background:#0E1412; color:#ECE0C4;
         font:15px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,sans-serif; }}
  header {{ padding:48px 56px 28px; border-bottom:1px solid #24322B; }}
  h1 {{ margin:0 0 10px; font-size:30px; letter-spacing:-.4px; }}
  header p {{ margin:0 0 8px; max-width:78ch; color:#A99D80; }}
  img {{ display:block; border-radius:22.37%; }}
  figure {{ margin:0; }} figcaption {{ margin-top:8px; font-size:12px; color:#8E866F; text-align:center; }}
  .board {{ padding:34px 56px 26px; }}
  .board h3 {{ margin:0 0 20px; font-size:13px; letter-spacing:1.4px; text-transform:uppercase;
               color:#5FA877; font-weight:700; }}
  .gridwrap {{ display:flex; flex-wrap:wrap; gap:26px; }}
  .g img {{ width:126px; height:126px; }} .g figcaption {{ max-width:126px; }}
  .row {{ display:flex; gap:44px; padding:30px 56px; border-bottom:1px solid #1C2622; align-items:flex-start; }}
  .meta {{ flex:0 0 280px; }} .meta h2 {{ margin:0 0 10px; font-size:19px; }}
  .meta p {{ margin:0 0 10px; color:#A99D80; font-size:14px; }}
  .key {{ font-size:12px; }} code {{ background:#1A231F; padding:2px 6px; border-radius:5px; color:#8E866F; }}
  .shots {{ display:flex; gap:22px; align-items:flex-start; flex-wrap:wrap; }}
  .shots > figure img {{ width:168px; height:168px; }}
  .small {{ display:flex; gap:16px; align-items:flex-end; padding-left:20px; border-left:1px solid #24322B; }}
  .small figcaption {{ font-size:11px; }}
  a {{ color:#5FA877; }}
</style></head><body>
<header><h1>Skipper — app icon, round 2</h1>
<p>Three directions you kept, four real executions each. The variables are the ones that
actually decide it: stroke weight, whether the centre line earns its place, paper vs pine
ground, and — for Road Wave — whether the waveform can be made to read as a road at all.</p>
<p>Built against the round-1 finding: iOS&nbsp;26 derives tinted and clear by <b>luminance</b>,
so amber-on-pine and amber-on-cream both collapse. <code>vp-safe</code> is the explicit test of
demoting amber to decoration. <a href="gallery.html">← round 1</a></p></header>
{''.join(out)}
</body></html>"""


if __name__ == "__main__":
    main()
