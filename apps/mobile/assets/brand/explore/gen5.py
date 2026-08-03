#!/usr/bin/env python3
"""
Production asset set for the chosen mark: `s3-i` — the drawn switchback S with a
dashed centre line. Emits SVG sources + 1024 PNGs into ./final, ready to be
copied over apps/mobile/assets when the founder gives the go.

Decisions this encodes, and why:

  · The amber head dot sits ON the pine stroke, not on the paper, so the contrast
    that matters is amber-vs-pine (2.63:1) not amber-vs-paper. `amberBurnt` would
    score 4.95:1 on paper but only 1.31:1 on pine and would sink into the stroke,
    so `amberSunset` stays. Under the 3:1 non-text bar either way — which is fine
    only because the dot is decorative and the mark does not depend on it.

  · The tinted asset is a fully opaque GRAYSCALE rendition with a light symbol on
    a dark ground: iOS applies the tint itself, and omitting the slot makes it tint
    the original artwork instead, which Apple warns produces an undesired look.

  · Two splash assets, not one. `expo-splash-screen` currently points image and
    dark.image at the same file; a bare letterform cannot serve both grounds
    (pine on night measures 2.10:1). Requires repointing dark.image.

Run:  python3 gen5.py
"""
import os
from PIL import Image
from gen import DAY, DUSK, rsvg
from gen3 import DRAWN

HERE = os.path.dirname(os.path.abspath(__file__))
FINAL = os.path.join(HERE, "final")
os.makedirs(FINAL, exist_ok=True)

PAPER, PINE, AMBER = DAY["cream"], DAY["pine"], DAY["amber"]
NIGHT, PARCH, LANTERN = DUSK["pine"], DUSK["cream"], DUSK["amber"]
HEAD, W = (726, 344), 150


def art(stroke, dash, dot, bg=None, scale=1.0):
    body = f'<rect width="1024" height="1024" fill="{bg}"/>' if bg else ""
    body += f'<g transform="translate(512,512) scale({scale}) translate(-512,-512)">'
    body += (f'<path d="{DRAWN}" fill="none" stroke="{stroke}" stroke-width="{W}" '
             'stroke-linecap="round" stroke-linejoin="round"/>')
    body += (f'<path d="{DRAWN}" fill="none" stroke="{dash}" stroke-width="{W//9}" '
             f'stroke-linecap="round" stroke-dasharray="{W//4} {W//3}"/>')
    body += f'<circle cx="{HEAD[0]}" cy="{HEAD[1]}" r="{W//5}" fill="{dot}"/></g>'
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
            f'viewBox="0 0 1024 1024">{body}</svg>')


ASSETS = [
    # name, svg, note
    ("icon", art(PINE, PAPER, AMBER, bg=PAPER),
     "iOS light / default. Full-bleed opaque, no rounded corners — the OS masks it."),
    ("icon-dark", art(PARCH, NIGHT, LANTERN, bg=NIGHT),
     "iOS dark. Same silhouette, dusk values."),
    ("icon-tinted", art("#FFFFFF", "#242426", "#8E8E93", bg="#1C1C1E"),
     "iOS tinted. Opaque grayscale, light symbol on dark ground; the system applies the tint."),
    ("adaptive-icon", art(PAPER, PINE, AMBER, scale=0.62),
     "Android foreground, transparent. 62% keeps the mark inside the 66% launcher safe zone; "
     "background #1E5B40 comes from app.json."),
    ("splash-icon", art(PINE, PAPER, AMBER, scale=0.94),
     "Splash, LIGHT ground (#F2E7CC). Transparent outside the mark."),
    ("splash-icon-dark", art(PARCH, NIGHT, LANTERN, scale=0.94),
     "Splash, DARK ground (#14201B). NEW asset — app.json's splash dark.image must be repointed "
     "here; it currently reuses the light file."),
]


def main():
    for name, svg_text, _ in ASSETS:
        s = os.path.join(FINAL, f"{name}.svg")
        open(s, "w").write(svg_text)
        rsvg(s, os.path.join(FINAL, f"{name}.png"))
    open(os.path.join(HERE, "final.html"), "w").write(page())
    for name, _, _ in ASSETS:
        im = Image.open(os.path.join(FINAL, f"{name}.png"))
        print(f"  {name+'.png':22} {im.size[0]}x{im.size[1]}  {im.mode}")
    print(f"\nfinal assets -> {FINAL}")


def page():
    cards = "".join(f"""
<section class="row">
  <div class="meta"><h2>{n}.png</h2><p>{note}</p>
    <p class="key"><code>final/{n}.svg</code> → <code>final/{n}.png</code></p></div>
  <div class="shots">
    <figure class="{'chk' if n in ('adaptive-icon','splash-icon','splash-icon-dark') else ''}">
      <img src="final/{n}.png"><figcaption>1024 × 1024</figcaption></figure>
    <div class="small">{''.join(f'<figure><img src="final/{n}.png" style="width:{px}px;height:{px}px"><figcaption>{px}</figcaption></figure>' for px in (120,80,60,40))}</div>
  </div>
</section>""" for n, _, note in ASSETS)
    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>Skipper — final assets</title>
<style>
  :root {{ color-scheme: dark; }} * {{ box-sizing:border-box; }}
  body {{ margin:0; background:#0E1412; color:#ECE0C4;
         font:15px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,sans-serif; }}
  header {{ padding:48px 56px 30px; border-bottom:1px solid #24322B; }}
  h1 {{ margin:0 0 10px; font-size:30px; letter-spacing:-.4px; }}
  header p {{ margin:0 0 10px; max-width:82ch; color:#A99D80; }}
  img {{ display:block; border-radius:22.37%; width:180px; height:180px; }}
  .chk {{ background-image:linear-gradient(45deg,#1b2420 25%,transparent 25%),
          linear-gradient(-45deg,#1b2420 25%,transparent 25%),
          linear-gradient(45deg,transparent 75%,#1b2420 75%),
          linear-gradient(-45deg,transparent 75%,#1b2420 75%);
          background-size:18px 18px; background-position:0 0,0 9px,9px -9px,-9px 0;
          border-radius:14px; padding:8px; }}
  figure {{ margin:0; }} figcaption {{ margin-top:8px; font-size:12px; color:#8E866F; text-align:center; }}
  .row {{ display:flex; gap:40px; padding:30px 56px; border-bottom:1px solid #1C2622; align-items:flex-start; }}
  .meta {{ flex:0 0 330px; }} .meta h2 {{ margin:0 0 10px; font-size:19px; }}
  .meta p {{ margin:0 0 10px; color:#A99D80; font-size:14px; }}
  .key {{ font-size:12px; }} code {{ background:#1A231F; padding:2px 6px; border-radius:5px; color:#8E866F; }}
  .shots {{ display:flex; gap:26px; align-items:flex-start; flex-wrap:wrap; }}
  .small {{ display:flex; gap:14px; align-items:flex-end; padding-left:18px; border-left:1px solid #24322B; }}
  .small figcaption {{ font-size:11px; }}
  a {{ color:#5FA877; }} b.warn {{ color:#EBA351; }}
</style></head><body>
<header><h1>Skipper — final assets, ready to land</h1>
<p>The chosen mark (<code>s3-i</code>) carried across every surface. Checkerboard = transparent.
Nothing here has been copied over the shipped assets and <code>app.json</code> is untouched.</p>
<p><b class="warn">Two config changes this needs when it lands:</b> splash <code>dark.image</code>
repointed at the new <code>splash-icon-dark.png</code> (it currently reuses the light file, which
puts pine on night at 2.10:1), and <code>ios.icon.tinted</code> added so iOS stops deriving the
tinted variant from the full-colour artwork.</p>
<p><a href="family.html">← family</a> · <a href="round3.html">round 3</a> ·
<a href="round2.html">round 2</a> · <a href="gallery.html">round 1</a></p></header>
{cards}
</body></html>"""


if __name__ == "__main__":
    main()
