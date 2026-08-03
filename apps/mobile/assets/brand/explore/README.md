# App-icon exploration — how the switchback S was arrived at

The shipped mark lives in `../` (`icon.svg` and friends, built by `../build.sh`). This folder is
the **reasoning** behind it, kept because the conclusions are cheap to lose and expensive to
re-derive. Only the generators are committed; every image and gallery regenerates:

```sh
brew install librsvg                       # rsvg-convert
python3 -m pip install pillow
python3 gen.py && python3 gen2.py && python3 gen3.py && python3 gen4.py && python3 gen5.py
python3 -m http.server 8899                # then open gallery.html / round2 / round3 / family / final
```

`gen5.py` writes `final/`, which is what was copied into `../` and `../../`. Re-running it
reproduces the shipped assets byte-for-byte.

## The rounds

| file | what it settled |
|---|---|
| `gen.py`  | 8 directions, spread wide. Also the palettes + the tinted simulator everything else imports. |
| `gen2.py` | The 3 road marks that survived, 4 executions each. |
| `gen3.py` | Finalist finish work, plus the safe-zone and home-screen diagnostics. |
| `gen4.py` | The full asset family — this is where the splash constraint surfaced. |
| `gen5.py` | Production output. |

## What the exploration actually proved

These are the durable bits; the rest is taste.

- **The category is saturated-field-plus-mountain.** AllTrails, Gaia GPS, komoot, NPS,
  Recreation.gov and CalTopo all occupy it, and GuideAlong / Autio / Roadtrippers own the map pin.
  The old "M1 compass porthole" sat in both lanes at once. **Paper is the ground nobody uses**,
  which is why the shipped icon is cream — verified in `gen3.homescreen()`, which drops the
  candidate into a grid of real App Store artwork at true 60pt @3x. That mock is the single most
  useful test here; run it before changing the ground colour.

- **iOS derives tinted and clear by LUMINANCE, not hue.** `gen.tinted()` simulates it
  (Rec.709 luminance → monochrome ramp) and it repeatedly caught things the eye missed: the
  mascot's amber smile vanished against pine, the WPA sunrise's amber sun vanished against cream.
  Measured: amber is 2.63:1 on pine and 2.47:1 on paper, under the 3:1 non-text bar on **both**
  grounds. Hence the rule in `../build.sh` — amber is decorative, never load-bearing.

- **The splash needs two assets.** `expo-splash-screen` renders one image over paper in light and
  night in dark. A disc mark survives that by carrying its own ground; a bare letterform does not
  (pine on night = 2.10:1). `gen4.py` renders the failure case deliberately.

## Dead ends, so they don't get re-tried

- **Sound contours** (topo rings as a voice carrying) — read as a random swoosh.
- **Sun Road** (sun + tapered road tail as one silhouette) — read unmistakably as a **keyhole**.
- **Full radial sunburst** — reads as the Rising Sun flag. Rays must stay in the sky hemisphere.
- **A right-angled switchback S** (`gen3.py` `SPINE`, executions `s3-a`…`s3-h`) — squaring the
  letterform makes it read as a **5**. This is the one that looks most plausible in code and fails
  hardest on screen; `gen3.py` keeps it renderable precisely so the next person can see that.
- **The persona marks** (a ranger campaign hat; a full mascot face) were genuinely strong and are
  the only directions that say *a person will talk to you* — the actual product bet. Cut on
  founder call, not on merit. If the icon is ever revisited, start there.
