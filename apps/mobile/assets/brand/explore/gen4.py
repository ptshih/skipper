#!/usr/bin/env python3
"""
Round 3b — the full asset FAMILY for the two drawn finalists (s3-i / s3-j).

The rectilinear rebuild in gen3.py is a dead end: right-angling the letterform
makes it read as a "5". These are the drawn-S survivors, carried through every
surface the mark actually has to serve.

The splash is the constraint that bites. `expo-splash-screen` is configured with
image + dark.image both pointing at ONE file, over paper #F2E7CC in light and
night #14201B in dark. A disc mark survives that because it carries its own
ground; a bare letterform does not. Two ways out, both rendered here:

  DISC   — one asset, mark inside a pine disc, transparent corners. No config change.
  SPLIT  — two assets, bare mark recoloured per ground. Needs dark.image repointed
           at splash-icon-dark.png, which the plugin already supports.

Run:  python3 gen4.py
"""
import os
from PIL import Image, ImageDraw
from gen import DAY, DUSK, rsvg, tinted, OUT
from gen3 import DRAWN, homescreen

HERE = os.path.dirname(os.path.abspath(__file__))
FAM = os.path.join(OUT, "fam")
os.makedirs(FAM, exist_ok=True)

P = DAY
PAPER, PINE, AMBER, NIGHT, PARCH = (
    P["cream"], P["pine"], P["amber"], DUSK["pine"], DUSK["cream"])
HEAD = (726, 344)


def mark(stroke, dash=None, amber=None, w=150, scale=1.0, bg=None, disc=None):
    """Emit the S mark. bg=None -> transparent (splash / adaptive)."""
    body = ""
    if bg:
        body += f'<rect width="1024" height="1024" fill="{bg}"/>'
    if disc:
        body += f'<circle cx="512" cy="512" r="500" fill="{disc}"/>'
    g = f'<g transform="translate(512,512) scale({scale}) translate(-512,-512)">'
    g += (f'<path d="{DRAWN}" fill="none" stroke="{stroke}" stroke-width="{w}" '
          'stroke-linecap="round" stroke-linejoin="round"/>')
    if dash:
        g += (f'<path d="{DRAWN}" fill="none" stroke="{dash}" stroke-width="{w//9}" '
              f'stroke-linecap="round" stroke-dasharray="{w//4} {w//3}"/>')
    if amber:
        g += f'<circle cx="{HEAD[0]}" cy="{HEAD[1]}" r="{w//5}" fill="{amber}"/>'
    g += "</g>"
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
            f'viewBox="0 0 1024 1024">{body}{g}</svg>')


def render(name, svg_text, size=1024):
    s = os.path.join(FAM, name + ".svg")
    open(s, "w").write(svg_text)
    rsvg(s, os.path.join(FAM, name + ".png"), size)
    return os.path.join(FAM, name + ".png")


def splash_mock(mark_png, bg_hex, out_png, w=1170, h=760):
    """The mark at its real 240pt width on the real splash background."""
    bg = Image.new("RGB", (w, h), bg_hex)
    im = Image.open(mark_png).convert("RGBA")
    side = int(240 * (w / 390))          # 240pt on a 390pt-wide screen
    im = im.resize((side, side), Image.LANCZOS)
    bg.paste(im, ((w - side) // 2, (h - side) // 2), im)
    bg.save(out_png)


def adaptive_mock(mark_png, out_png):
    """Android adaptive foreground on the configured pine background, circle-masked
    to the 66% safe zone the launcher may crop to."""
    S = 512
    bg = Image.new("RGBA", (S, S), PINE)
    im = Image.open(mark_png).convert("RGBA").resize((S, S), Image.LANCZOS)
    bg.alpha_composite(im)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, S - 1, S - 1], fill=255)
    out = Image.new("RGB", (S, S), "#0E1412")
    out.paste(bg.convert("RGB"), (0, 0), mask)
    d = ImageDraw.Draw(out)
    m = int(S * 0.17)
    d.ellipse([m, m, S - m, S - m], outline=(95, 200, 130, 220), width=3)
    out.save(out_png)


FINALISTS = [
    ("i", "Drawn S · dashed", True),
    ("j", "Drawn S · clean", False),
]


def main():
    for key, _, dashed in FINALISTS:
        # ── launcher icon: full bleed, opaque
        render(f"{key}-icon-light",
               mark(PINE, PAPER if dashed else None, AMBER, bg=PAPER))
        render(f"{key}-icon-dark",
               mark(PARCH, NIGHT if dashed else None, DUSK["amber"], bg=NIGHT))
        tinted(os.path.join(FAM, f"{key}-icon-light.png"),
               os.path.join(FAM, f"{key}-icon-tinted.png"))

        # ── splash, DISC route: one asset, works on either ground
        render(f"{key}-splash-disc",
               mark(PAPER, PINE if dashed else None, AMBER, scale=0.72, disc=PINE))

        # ── splash, SPLIT route: bare mark, recoloured per ground
        render(f"{key}-splash-light", mark(PINE, PAPER if dashed else None, AMBER, scale=0.94))
        render(f"{key}-splash-dark",
               mark(PARCH, NIGHT if dashed else None, DUSK["amber"], scale=0.94))

        # ── Android adaptive foreground: mark inside the central 66%
        render(f"{key}-adaptive", mark(PAPER, PINE if dashed else None, AMBER, scale=0.62))

        # mocks
        splash_mock(os.path.join(FAM, f"{key}-splash-disc.png"), PAPER,
                    os.path.join(FAM, f"{key}-mock-disc-light.png"))
        splash_mock(os.path.join(FAM, f"{key}-splash-disc.png"), NIGHT,
                    os.path.join(FAM, f"{key}-mock-disc-dark.png"))
        splash_mock(os.path.join(FAM, f"{key}-splash-light.png"), PAPER,
                    os.path.join(FAM, f"{key}-mock-split-light.png"))
        splash_mock(os.path.join(FAM, f"{key}-splash-dark.png"), NIGHT,
                    os.path.join(FAM, f"{key}-mock-split-dark.png"))
        # the failure case worth seeing: the LIGHT splash asset on the DARK ground
        splash_mock(os.path.join(FAM, f"{key}-splash-light.png"), NIGHT,
                    os.path.join(FAM, f"{key}-mock-broken.png"))
        adaptive_mock(os.path.join(FAM, f"{key}-adaptive.png"),
                      os.path.join(FAM, f"{key}-adaptive-mock.png"))
        homescreen(os.path.join(FAM, f"{key}-icon-light.png"),
                   os.path.join(FAM, f"{key}-home.png"))

    open(os.path.join(HERE, "family.html"), "w").write(page())
    print(f"family -> {FAM}")


def page():
    def block(key, title, dashed):
        return f"""
<div class="board"><h3>{title} &nbsp;<code>s3-{key}</code></h3>

<h4>Launcher icon</h4>
<div class="gridwrap">
  <figure><img src="out/fam/{key}-icon-light.png"><figcaption>Default</figcaption></figure>
  <figure><img src="out/fam/{key}-icon-dark.png"><figcaption>Dark</figcaption></figure>
  <figure><img src="out/fam/{key}-icon-tinted.png"><figcaption>Tinted (sim)</figcaption></figure>
  <div class="small">{''.join(f'<figure><img src="out/fam/{key}-icon-light.png" style="width:{px}px;height:{px}px"><figcaption>{px}</figcaption></figure>' for px in (120,80,60,40))}</div>
</div>

<h4>On a home screen, among real icons</h4>
<div class="gridwrap"><figure class="m"><img src="out/fam/{key}-home.png"><figcaption>60pt @3x, dusk wallpaper</figcaption></figure></div>

<h4>Splash &mdash; DISC route <span class="tag ok">one asset &middot; no config change</span></h4>
<p class="note">The mark inside a pine disc with transparent corners, exactly how the shipped
splash survives today. Same file on both grounds.</p>
<div class="gridwrap">
  <figure class="w"><img src="out/fam/{key}-mock-disc-light.png"><figcaption>paper #F2E7CC</figcaption></figure>
  <figure class="w"><img src="out/fam/{key}-mock-disc-dark.png"><figcaption>night #14201B</figcaption></figure>
</div>

<h4>Splash &mdash; SPLIT route <span class="tag">two assets &middot; repoint dark.image</span></h4>
<p class="note">The bare letterform, recoloured per ground. Cleaner and more confident, but it
only works if <code>dark.image</code> stops pointing at the light file &mdash; which the plugin
already supports.</p>
<div class="gridwrap">
  <figure class="w"><img src="out/fam/{key}-mock-split-light.png"><figcaption>paper, light asset</figcaption></figure>
  <figure class="w"><img src="out/fam/{key}-mock-split-dark.png"><figcaption>night, dark asset</figcaption></figure>
</div>
<p class="note bad">&#9888; What happens if the config is left as-is &mdash; the LIGHT asset on the
night ground. Not invisible, but murky: pine on night measures <b>2.10:1</b>, under the 3:1
non-text bar (WCAG&nbsp;2.1 SC&nbsp;1.4.11) this repo already measures the route line against.
Correct pairings are 6.50:1 on paper and 12.80:1 on night.</p>
<div class="gridwrap">
  <figure class="w"><img src="out/fam/{key}-mock-broken.png"><figcaption>pine mark on night &mdash; 2.10:1</figcaption></figure>
</div>

<h4>Android adaptive foreground</h4>
<p class="note">On the configured <code>#1E5B40</code> background, circle-masked. Green ring is the
66% safe zone a launcher may crop to.</p>
<div class="gridwrap">
  <figure><img src="out/fam/{key}-adaptive-mock.png" class="sq"><figcaption>adaptive, masked</figcaption></figure>
</div>
</div>"""

    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>Skipper — icon + splash family</title>
<style>
  :root {{ color-scheme: dark; }} * {{ box-sizing:border-box; }}
  body {{ margin:0; background:#0E1412; color:#ECE0C4;
         font:15px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,sans-serif; }}
  header {{ padding:48px 56px 28px; border-bottom:1px solid #24322B; }}
  h1 {{ margin:0 0 10px; font-size:30px; letter-spacing:-.4px; }}
  header p {{ margin:0 0 8px; max-width:80ch; color:#A99D80; }}
  img {{ display:block; border-radius:22.37%; width:150px; height:150px; }}
  img.sq {{ border-radius:0; width:200px; height:200px; }}
  .m img, .w img {{ border-radius:12px; width:auto; height:auto; max-width:400px; }}
  figure {{ margin:0; }} figcaption {{ margin-top:8px; font-size:12px; color:#8E866F; text-align:center; }}
  .board {{ padding:34px 56px 30px; border-bottom:1px solid #24322B; }}
  .board h3 {{ margin:0 0 22px; font-size:15px; letter-spacing:1.2px; text-transform:uppercase;
               color:#5FA877; font-weight:700; }}
  h4 {{ margin:28px 0 8px; font-size:13px; letter-spacing:1.1px; text-transform:uppercase; color:#A99D80; }}
  .gridwrap {{ display:flex; flex-wrap:wrap; gap:24px; align-items:flex-start; }}
  .small {{ display:flex; gap:14px; align-items:flex-end; padding-left:18px; border-left:1px solid #24322B; }}
  .small img {{ border-radius:22.37%; }} .small figcaption {{ font-size:11px; }}
  .note {{ margin:6px 0 12px; max-width:80ch; color:#8E866F; font-size:13px; }}
  .note.bad {{ color:#E97559; }}
  code {{ background:#1A231F; padding:2px 6px; border-radius:5px; color:#8E866F; }}
  .tag {{ font-size:11px; padding:3px 8px; border-radius:20px; background:#2A2016; color:#EBA351;
          letter-spacing:.4px; text-transform:none; }}
  .tag.ok {{ background:#16281D; color:#5FA877; }}
  a {{ color:#5FA877; }}
</style></head><body>
<header><h1>Skipper — icon <i>and</i> splash, the whole family</h1>
<p>Only the <b>drawn</b> S survives. Right-angling the letterform (round 3, <code>s3-a</code>…<code>s3-h</code>)
makes it read as a <b>5</b> — that whole branch is dead.</p>
<p>Every surface the mark has to serve: launcher icon in three appearances, a home screen among real
App Store artwork, both viable splash routes with the failure case shown, and the Android adaptive
foreground against its 66% safe zone.</p>
<p>⚠ One measurement that constrains the amber: the head dot is <b>2.63:1</b> on pine and
<b>2.47:1</b> on paper — under the 3:1 non-text bar on <i>both</i> grounds. That is the same
finding the round-1 tinted simulation surfaced, now quantified. Amber can stay as an accent the
mark does not depend on; it cannot become load-bearing.
<a href="round3.html">← round 3</a> · <a href="round2.html">round 2</a> · <a href="gallery.html">round 1</a></p></header>
{''.join(block(k, t, d) for k, t, d in FINALISTS)}
</body></html>"""


if __name__ == "__main__":
    main()
