#!/usr/bin/env python3
"""
App-icon exploration rig — round 1.

Each concept is a function returning full-bleed 1024x1024 SVG for a given palette.
Renders: default (day), dark (dusk), and a simulated iOS-26 TINTED variant
(luminance -> monochrome ramp), plus small-size strips. Emits gallery.html.

Run:  python3 gen.py     (needs rsvg-convert + Pillow)
"""
import os, subprocess, colorsys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

# ── palettes (from src/theme/tokens.ts) ───────────────────────────────────────
DAY = dict(
    cream="#F2E7CC", creamHi="#FBF3DD", pine="#1E5B40", pineDeep="#15402F",
    amber="#DD7A33", ink="#2A2014", tan="#CDB988", teal="#2C6E7E",
)
DUSK = dict(
    cream="#ECE0C4", creamHi="#F4EBD6", pine="#14201B", pineDeep="#0D1712",
    amber="#EBA351", ink="#0A0F0C", tan="#3A4A3E", teal="#5FA7B8",
)

# Each concept declares whether its FIELD is paper or pine in the day palette.
# In dusk everything grounds on night-pine so the whole set reads as one family.


def _f(p, paper_field, override=None):
    """Resolve field / mark / accent. `override` forces paper (True) or pine (False)."""
    if override is not None:
        paper_field = override
    if p is DUSK:
        return p["pine"], p["cream"], p["amber"]
    if paper_field:
        return p["cream"], p["pine"], p["amber"]
    return p["pine"], p["cream"], p["amber"]


def svg(body, field):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
        'viewBox="0 0 1024 1024">'
        f'<rect width="1024" height="1024" fill="{field}"/>{body}</svg>'
    )


# ── 1. RANGER HAT — the guide himself, no mountain, no pin ────────────────────
def hat(p, o=None):
    field, mark, accent = _f(p, True, o)
    b = f"""
    <ellipse cx="512" cy="678" rx="366" ry="94" fill="{mark}"/>
    <path d="M 330 672 C 340 524 380 396 512 306 C 644 396 684 524 694 672 Z" fill="{mark}"/>
    <path d="M 336 612 L 688 612 L 694 672 L 330 672 Z" fill="{accent}"/>
    <path d="M 512 318 C 466 372 442 452 432 556 L 470 570 C 480 470 494 396 512 348 Z"
          fill="{field}" opacity="0.22"/>
    <path d="M 512 318 C 558 372 582 452 592 556 L 554 570 C 544 470 530 396 512 348 Z"
          fill="{field}" opacity="0.22"/>
    """
    return svg(b, field)


# ── 2. THE GRIN — full mascot; hat brim + eyes + a corny amber smile ──────────
def grin(p, o=None):
    field, mark, accent = _f(p, False, o)
    b = f"""
    <ellipse cx="512" cy="410" rx="356" ry="82" fill="{mark}"/>
    <path d="M 358 406 C 366 288 400 200 512 136 C 624 200 658 288 666 406 Z" fill="{mark}"/>
    <path d="M 362 356 L 662 356 L 666 406 L 358 406 Z" fill="{accent}"/>
    <circle cx="418" cy="592" r="42" fill="{mark}"/>
    <circle cx="606" cy="592" r="42" fill="{mark}"/>
    <path d="M 340 676 Q 512 906 684 676 Q 512 790 340 676 Z" fill="{accent}"/>
    """
    return svg(b, field)


# ── 3. SWITCHBACK S — a letterform that is also a mountain road ───────────────
def switchback(p, o=None):
    field, mark, accent = _f(p, True, o)
    d = "M 664 366 A 154 154 0 1 0 512 520 A 154 154 0 1 1 360 674"
    b = f"""
    <path d="{d}" fill="none" stroke="{mark}" stroke-width="146" stroke-linecap="round"/>
    <path d="{d}" fill="none" stroke="{field}" stroke-width="18" stroke-linecap="round"
          stroke-dasharray="40 54"/>
    <circle cx="664" cy="366" r="30" fill="{accent}"/>
    """
    return svg(b, field)


# ── 4. VANISHING POINT — the road recedes into the sun. The drive itself. ─────
def vanishing(p, o=None):
    field, mark, accent = _f(p, False, o)
    b = f"""
    <circle cx="512" cy="368" r="196" fill="{accent}"/>
    <path d="M 176 1024 L 454 436 L 570 436 L 848 1024 Z" fill="{mark}"/>
    <path d="M 512 470 L 512 1024" stroke="{field}" stroke-width="26"
          stroke-dasharray="54 74" stroke-linecap="round" fill="none"/>
    """
    return svg(b, field)


# ── 5. CAR TOKEN — the app's own signature move, alone and big ───────────────
def token(p, o=None):
    field, mark, accent = _f(p, True, o)
    ink = p["ink"] if p is DAY else p["pineDeep"]
    car = f"""
    <g transform="translate(-710,-836) scale(2.35)">
      <circle cx="436" cy="596" r="46" fill="{ink}"/>
      <circle cx="600" cy="596" r="46" fill="{ink}"/>
      <circle cx="436" cy="596" r="17" fill="{accent}"/>
      <circle cx="600" cy="596" r="17" fill="{accent}"/>
      <path d="M 366 572 C 366 554 375 545 392 543 L 432 538 L 460 504
               C 469 490 483 483 502 483 L 560 483 C 581 483 596 492 606 511
               L 624 542 L 648 546 C 665 549 674 559 674 574 L 674 580
               C 674 591 666 598 655 598 L 385 598 C 375 598 366 589 366 579 Z"
            fill="{accent}"/>
      <path d="M 472 510 L 491 490 L 524 490 L 524 512 L 470 512 Z" fill="{ink}"/>
      <path d="M 536 490 L 558 490 C 574 490 587 498 596 512 L 536 512 Z" fill="{ink}"/>
    </g>"""
    b = f"""
    <path d="M 20 754 Q 300 700 512 722 T 1004 688" fill="none" stroke="{mark}"
          stroke-width="40" stroke-dasharray="5 66" stroke-linecap="round"/>
    {car}
    """
    return svg(b, field)


# ── 6. SOUND CONTOURS — topo rings that are also a voice carrying ────────────
def bullhorn(p, o=None):
    """The voice itself — the corny guide on the PA. Category-empty territory."""
    import math
    field, mark, accent = _f(p, False, o)
    cx, cy = 690, 512
    arcs = []
    for r, w in ((118, 40), (196, 34), (274, 28)):
        a0, a1 = math.radians(-46), math.radians(46)
        x0, y0 = cx + r * math.cos(a0), cy + r * math.sin(a0)
        x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
        arcs.append(
            f'<path d="M {x0:.0f} {y0:.0f} A {r} {r} 0 0 1 {x1:.0f} {y1:.0f}" '
            f'fill="none" stroke="{accent}" stroke-width="{w}" stroke-linecap="round"/>'
        )
    b = f"""
    <path d="M 238 468 L 606 372 L 606 652 L 238 556 Z" fill="{mark}"/>
    <ellipse cx="606" cy="512" rx="54" ry="140" fill="{mark}"/>
    <path d="M 300 556 L 366 573 L 348 704 C 346 720 332 728 318 724
             L 296 718 C 282 714 276 700 279 686 Z" fill="{mark}"/>
    {''.join(arcs)}
    """
    return svg(b, field)


# ── 7. SUN ROAD — one silhouette: the sun IS the speech bubble IS the road ────
def roadwave(p, o=None):
    """The road IS the waveform — straight, then it talks, then straight again."""
    import math
    field, mark, accent = _f(p, False, o)
    pts, x0, x1 = [], 96, 928
    wa, wb, amp = 300, 724, 168
    x = x0
    while x <= x1:
        if x < wa or x > wb:
            y = 512.0
        else:
            t = (x - wa) / (wb - wa)
            y = 512 - math.sin(t * 2 * math.pi) * amp * math.sin(t * math.pi) ** 0.6
        pts.append(f"{x:.0f},{y:.0f}")
        x += 8
    b = f"""
    <polyline points="{' '.join(pts)}" fill="none" stroke="{mark}"
              stroke-width="84" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="96" cy="512" r="52" fill="{accent}"/>
    <circle cx="928" cy="512" r="52" fill="{accent}"/>
    """
    return svg(b, field)


# ── 8. SUNBURST — the WPA poster pole of the spread (control) ────────────────
def sunrise(p, o=None):
    """WPA sunrise over the road. Rays confined to the sky — a full radial burst
    reads as the Rising Sun flag, which is why the first cut was scrapped."""
    import math
    field, mark, accent = _f(p, False, o)
    cx, cy, r = 512, 690, 760
    rays = []
    for i in range(9):
        a = math.radians(188 + i * 20.5)
        hw = math.radians(5.4)
        x1, y1 = cx + r * math.cos(a - hw), cy + r * math.sin(a - hw)
        x2, y2 = cx + r * math.cos(a + hw), cy + r * math.sin(a + hw)
        rays.append(
            f'<path d="M {cx} {cy} L {x1:.0f} {y1:.0f} L {x2:.0f} {y2:.0f} Z" fill="{mark}"/>'
        )
    b = f"""
    {''.join(rays)}
    <circle cx="512" cy="690" r="252" fill="{accent}"/>
    <path d="M 0 690 L 1024 690 L 1024 1024 L 0 1024 Z" fill="{mark}"/>
    <path d="M 0 862 L 1024 862" stroke="{field}" stroke-width="34"
          stroke-dasharray="74 96" stroke-linecap="round" fill="none"/>
    """
    return svg(b, field)


CONCEPTS = [
    ("hat", "The Ranger Hat", hat,
     "The guide, not the terrain. A campaign-hat silhouette is unmistakable at 40px and nobody in the category owns it. Paper field = pops on a home screen of saturated tiles."),
    ("grin", "The Grin", grin,
     "Full mascot. Maximum charm, maximum risk — reads as a face before it reads as an app. Mascot icons are a 2026 trend and this category has zero of them."),
    ("switchback", "Switchback S", switchback,
     "A letterform that is also a mountain road, with a centre line. Strava/Audible technique: one glyph, two meanings, survives any size."),
    ("vanishing", "Vanishing Point", vanishing,
     "The drive itself — road receding into a low sun. Pure WPA composition, no mountain, no pin. Strongest 'open road' read of the set."),
    ("token", "The Car Token", token,
     "The app's existing signature move (the car on the trail), alone and big. Warmest and most on-brand; also the busiest — watch it at 40px."),
    ("bullhorn", "The Bullhorn", bullhorn,
     "The voice, not the map — the corny guide on the PA. Nothing in the category says 'someone is talking to you'. Risk: bullhorns can read as protest/marketing."),
    ("roadwave", "Road Wave", roadwave,
     "The road IS the waveform: straight, then it talks, then straight again. The cleanest fusion of the two things the product actually is."),
    ("sunrise", "WPA Sunrise", sunrise,
     "The poster pole of the spread — rays confined to the sky over a dashed road. Gorgeous and unmistakably Trailhead 89; says the least about what the app does."),
]

# Field-colour test: isolates the paper-vs-pine decision from the shape decision.
FIELD_TEST = [("hat", hat), ("switchback", switchback), ("vanishing", vanishing), ("sunrise", sunrise)]


# ── render helpers ────────────────────────────────────────────────────────────
def rsvg(src, dst, size=1024):
    subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), src, "-o", dst],
                   check=True)


def tinted(src_png, dst_png, tint=(0x8F, 0xB4, 0xD8)):
    """Approximate iOS 26 tinted mode: luminance -> monochrome ramp on a dark base."""
    im = Image.open(src_png).convert("RGB")
    px = im.load()
    w, h = im.size
    base = (0x1A, 0x1E, 0x24)
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
            px[x, y] = tuple(int(base[i] + (tint[i] - base[i]) * L) for i in range(3))
    im.save(dst_png)


def main():
    rows = []
    for key, title, fn, why in CONCEPTS:
        for mode, pal in (("light", DAY), ("dark", DUSK)):
            s = os.path.join(OUT, f"{key}-{mode}.svg")
            open(s, "w").write(fn(pal))
            rsvg(s, os.path.join(OUT, f"{key}-{mode}.png"))
        tinted(os.path.join(OUT, f"{key}-light.png"),
               os.path.join(OUT, f"{key}-tinted.png"))
        rows.append((key, title, why))

    # field-colour test — same shape, both grounds
    for key, fn in FIELD_TEST:
        for tag, ov in (("paper", True), ("pine", False)):
            s = os.path.join(OUT, f"ft-{key}-{tag}.svg")
            open(s, "w").write(fn(DAY, ov))
            rsvg(s, os.path.join(OUT, f"ft-{key}-{tag}.png"))

    # baseline: the currently shipped icon
    for mode, src in (("light", "../../icon.png"), ("dark", "../../icon-dark.png")):
        p = os.path.abspath(os.path.join(HERE, src))
        Image.open(p).convert("RGB").save(os.path.join(OUT, f"current-{mode}.png"))
    tinted(os.path.join(OUT, "current-light.png"), os.path.join(OUT, "current-tinted.png"))

    open(os.path.join(HERE, "gallery.html"), "w").write(html(rows))
    print(f"wrote {len(rows)} concepts + baseline -> {OUT}")


def html(rows):
    def card(key, title, why, n):
        sizes = "".join(
            f'<figure class="s"><img src="out/{key}-light.png" style="width:{px}px;height:{px}px">'
            f'<figcaption>{px}px</figcaption></figure>'
            for px in (120, 80, 60, 40)
        )
        return f"""
<section class="row" id="{key}">
  <div class="meta"><span class="num">{n}</span><h2>{title}</h2><p>{why}</p>
    <p class="key">key: <code>{key}</code></p></div>
  <div class="shots">
    <figure><img src="out/{key}-light.png"><figcaption>Default</figcaption></figure>
    <figure><img src="out/{key}-dark.png"><figcaption>Dark</figcaption></figure>
    <figure><img src="out/{key}-tinted.png"><figcaption>Tinted (sim)</figcaption></figure>
    <div class="small">{sizes}</div>
  </div>
</section>"""

    cards = "".join(card(k, t, w, i + 1) for i, (k, t, w) in enumerate(rows))
    grid = "".join(
        f'<figure class="g"><img src="out/{k}-light.png"><figcaption>{t}</figcaption></figure>'
        for k, t, _ in rows
    )
    ftest = "".join(
        f'<div class="pair">'
        f'<figure class="g"><img src="out/ft-{k}-paper.png"><figcaption>paper</figcaption></figure>'
        f'<figure class="g"><img src="out/ft-{k}-pine.png"><figcaption>pine</figcaption></figure>'
        f'<div class="pairname">{k}</div></div>'
        for k, _ in FIELD_TEST
    )
    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>Skipper — app icon, round 1</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; background:#0E1412; color:#ECE0C4;
         font:15px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,sans-serif; }}
  header {{ padding:48px 56px 28px; border-bottom:1px solid #24322B; }}
  h1 {{ margin:0 0 10px; font-size:30px; letter-spacing:-.4px; }}
  header p {{ margin:0; max-width:74ch; color:#A99D80; }}
  img {{ display:block; border-radius:22.37%; }}
  figure {{ margin:0; }}
  figcaption {{ margin-top:8px; font-size:12px; color:#8E866F; text-align:center; }}

  .board {{ padding:34px 56px; border-bottom:1px solid #24322B; }}
  .board h3 {{ margin:0 0 20px; font-size:13px; letter-spacing:1.4px;
               text-transform:uppercase; color:#8E866F; font-weight:600; }}
  .gridwrap {{ display:flex; flex-wrap:wrap; gap:26px; }}
  .g img {{ width:118px; height:118px; }}
  .g figcaption {{ max-width:118px; }}
  .note {{ margin:-8px 0 20px; max-width:76ch; color:#8E866F; font-size:13px; }}
  .pair {{ display:flex; gap:10px; flex-wrap:wrap; width:246px;
           padding:14px; border:1px solid #24322B; border-radius:12px; }}
  .pairname {{ width:100%; text-align:center; font-size:12px; color:#5FA877;
               letter-spacing:1.2px; text-transform:uppercase; margin-top:4px; }}

  .row {{ display:flex; gap:44px; padding:38px 56px; border-bottom:1px solid #1C2622;
          align-items:flex-start; }}
  .meta {{ flex:0 0 290px; }}
  .num {{ display:inline-block; font-size:12px; color:#5FA877; letter-spacing:1.6px;
          font-weight:700; margin-bottom:6px; }}
  .meta h2 {{ margin:0 0 10px; font-size:21px; letter-spacing:-.2px; }}
  .meta p {{ margin:0 0 10px; color:#A99D80; font-size:14px; }}
  .key {{ font-size:12px; color:#6E6857; }}
  code {{ background:#1A231F; padding:2px 6px; border-radius:5px; }}
  .shots {{ display:flex; gap:22px; align-items:flex-start; flex-wrap:wrap; }}
  .shots > figure img {{ width:172px; height:172px; }}
  .small {{ display:flex; gap:16px; align-items:flex-end;
            padding-left:20px; border-left:1px solid #24322B; }}
  .small figcaption {{ font-size:11px; }}
</style></head><body>
<header>
  <h1>Skipper — app icon, round 1</h1>
  <p>Eight directions, deliberately spread wide. Each rendered full-bleed at 1024 and shown in
  <b>Default</b>, <b>Dark</b>, and a simulated <b>Tinted</b> variant — iOS&nbsp;26 derives tinted/clear
  by luminance, so anything that leans on hue contrast collapses there. The strip on the right is the
  honest test: 40&nbsp;px is a Settings row. Baseline (currently shipped) is last.</p>
</header>
<div class="board"><h3>All eight, side by side</h3><div class="gridwrap">{grid}</div></div>
<div class="board"><h3>Field-colour test &mdash; same shape, both grounds</h3>
<p class="note">Paper is the one ground nobody in the category uses; pine is the safe,
on-brand default. This isolates that decision from the shape decision, so we can settle
them separately.</p>
<div class="gridwrap">{ftest}</div></div>
{cards}
<section class="row" id="current">
  <div class="meta"><span class="num">BASELINE</span><h2>Currently shipped</h2>
  <p>&ldquo;M1 compass porthole&rdquo;. Green field + mountain + play triangle + compass — four ideas,
  and the ring is sub-pixel below ~120&nbsp;px. Here for comparison.</p></div>
  <div class="shots">
    <figure><img src="out/current-light.png"><figcaption>Default</figcaption></figure>
    <figure><img src="out/current-dark.png"><figcaption>Dark</figcaption></figure>
    <figure><img src="out/current-tinted.png"><figcaption>Tinted (sim)</figcaption></figure>
    <div class="small">
      <figure class="s"><img src="out/current-light.png" style="width:120px;height:120px"><figcaption>120px</figcaption></figure>
      <figure class="s"><img src="out/current-light.png" style="width:80px;height:80px"><figcaption>80px</figcaption></figure>
      <figure class="s"><img src="out/current-light.png" style="width:60px;height:60px"><figcaption>60px</figcaption></figure>
      <figure class="s"><img src="out/current-light.png" style="width:40px;height:40px"><figcaption>40px</figcaption></figure>
    </div>
  </div>
</section>
</body></html>"""


if __name__ == "__main__":
    main()
