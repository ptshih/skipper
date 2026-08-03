#!/usr/bin/env bun
// Composite a raw simulator screenshot into a branded App Store frame — §9 of
// docs/guides/app-store-submission.md. Read-only against the repo, spends nothing.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// §9 described a compositor "that reads the palette and type from apps/site/src/styles/tokens.css"
// as though it were a repo tool. **It was never committed** — verified against full git history, not
// just the working tree. So the six live assets could not be regenerated consistently by anyone, and
// the 1.1 recapture was blocked on rebuilding it. This is that rebuild.
//
// ⚠ **It renders the REAL design system, not a copy of it.** The frame is HTML styled by the site's
// own `tokens.css` and the same `@fontsource` families the landing page loads, rasterised by headless
// Chrome. That is the whole point: a compositor with its own hex values and its own font stack drifts
// from the product it is advertising, and nothing fails when it does — the listing has no test.
//
// ── RUN ──────────────────────────────────────────────────────────────────────────────────────────
//   bun run shot:compose -- --in raw.png --out framed.png --kicker "PLAN IT BY TALKING" \
//     --caption "Tell him where you're headed, in your own words."
//
//   --in/--out       required. Input should be a 1320×2868 capture (see --check).
//   --kicker         short all-caps line above the caption. Optional.
//   --caption        the sentence. Optional but effectively required — a frame with no words
//                    is just a screenshot with a border.
//   --no-check       skip the input-size assertion (use only for a deliberately odd source).
//
// ⚠ CAPTION POLICY (founder call 2026-07-28, §9b): exactly ONE caption in the whole set names the
// place, and it is the map shot — "Starting in Lake Tahoe". Tahoe is where we START, not what we ARE.
// This script cannot enforce that across a set; it is on whoever writes the captions.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const TOKENS = 'apps/site/src/styles/tokens.css'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Apple's required 6.9" slot, stored by ASC as APP_IPHONE_67. An iPhone 17 Pro Max simulator captures
// natively at exactly this, so the frame is 1:1 with the source and nothing is resampled.
const W = 1320
const H = 2868

const argv = process.argv.slice(2)
const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
  ?? (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined)
const has = (n: string) => argv.includes(`--${n}`)

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

const inPath = flag('in')
const outPath = flag('out')
if (!inPath || !outPath) die('Usage: --in <raw.png> --out <framed.png> [--kicker "…"] [--caption "…"]')
if (!existsSync(inPath)) die(`No such input: ${inPath}`)
if (!existsSync(CHROME)) die(`Chrome not found at ${CHROME} — it is the rasteriser.`)

const kicker = flag('kicker') ?? ''
const caption = flag('caption') ?? ''

/** Pull a `--name: value;` out of the site's token sheet. The ONE home for every colour below. */
function token(css: string, name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!m) die(`Token --${name} not found in ${TOKENS}. The design system moved; update this script.`)
  return m[1]!.trim()
}

/**
 * Embed a font as a data URI.
 *
 * ⚠ Data URIs rather than file:// paths, deliberately: headless Chrome resolves relative font URLs
 * against the temp HTML's directory, so a path-based @font-face silently falls back to a system serif
 * and the frame ships in the wrong typeface — a failure that looks fine until you compare it with the
 * landing page. Embedding removes the question.
 */
function fontFace(family: string, weight: number, file: string): string {
  const b64 = readFileSync(file).toString('base64')
  return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2');}`
}

function fontPath(pkg: string, file: string): string {
  // ⚠ `@fontsource/*` is a dependency of `apps/site`, NOT of the root — and under bun's ISOLATED
  // linker a workspace's deps are linked into that workspace, so there is no root
  // `node_modules/@fontsource` to read. Resolve through the site's own tree, and never through the
  // `.bun/<pkg>@<version>/` store path: that embeds a version number and breaks on the next install.
  const candidates = [
    join('apps', 'site', 'node_modules', pkg, 'files', file),
    join('node_modules', pkg, 'files', file),
  ]
  const found = candidates.find((p) => existsSync(p))
  if (!found) die(`Font missing: tried\n    ${candidates.join('\n    ')}\n  Run \`bun install\`.`)
  return found
}

const css = readFileSync(TOKENS, 'utf8')
const surface = token(css, 'surface')
const ink = token(css, 'ink')
const accentWarm = token(css, 'accent-warm')
const keyline = token(css, 'keyline')

const fonts =
  fontFace('Zilla Slab', 700, fontPath('@fontsource/zilla-slab', 'zilla-slab-latin-700-normal.woff2')) +
  fontFace('Lora', 400, fontPath('@fontsource/lora', 'lora-latin-400-normal.woff2'))

const shot = readFileSync(inPath).toString('base64')

// The frame. Proportions chosen so the device art keeps its full width — Apple renders these small in
// search results, and a shrunken screenshot inside a fat border is unreadable at thumbnail size. The
// words sit ABOVE, where a browser scanning a row of frames reads them first.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${fonts}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;background:${surface};overflow:hidden}
.frame{width:${W}px;height:${H}px;display:flex;flex-direction:column;align-items:center;
  padding:${kicker || caption ? '96px 72px 0' : '0'};}
.kicker{font-family:'Lora',Georgia,serif;font-weight:400;letter-spacing:.18em;text-transform:uppercase;
  font-size:34px;color:${accentWarm};margin-bottom:26px;text-align:center}
.caption{font-family:'Zilla Slab',Georgia,serif;font-weight:700;font-size:64px;line-height:1.16;
  color:${ink};text-align:center;margin-bottom:64px;max-width:1120px;text-wrap:balance}
/* ⚠ CONTAIN, not full-bleed width. The source is already ${W}×${H}, so at full width it is exactly as
   tall as the whole frame and ANY caption pushes its bottom off the canvas — the first cut silently
   ate the composer on a shot captioned "plan it by talking", which is the one control the caption is
   about. Losing content beats losing scale: the whole screen stays visible, centred, and the side
   margins read as a deliberate frame. */
.device{width:${W}px;flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center}
.device img{max-width:100%;max-height:100%;width:auto;height:auto;display:block;
  border:2px solid ${keyline};border-radius:28px}
</style></head><body><div class="frame">
${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}
${caption ? `<div class="caption">${esc(caption)}</div>` : ''}
<div class="device"><img src="data:image/png;base64,${shot}"></div>
</div></body></html>`

/**
 * Escape for HTML, and curl the quotes.
 *
 * ⚠ The apostrophe matters more than it sounds: every string in the app and on the landing page uses
 * a typographic ’ (voice.ts is full of them), so a caption typed with a straight ' sits next to the
 * app's own curly ones INSIDE THE SAME FRAME and reads as a different, cheaper typeface. Normalising
 * here means a caller cannot get it wrong from a shell, where typing ’ is awkward.
 */
function esc(s: string): string {
  return s
    .replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)
    .replace(/(\w)'(\w)/g, '$1’$2') // don't → don’t
    .replace(/'/g, '’')
    .replace(/"([^"]*)"/g, '“$1”')
}

function pngSize(path: string): { w: number; h: number } {
  // PNG IHDR: width/height are big-endian uint32 at byte offsets 16 and 20. Cheaper and more reliable
  // than shelling out to sips, and it keeps this script dependency-free.
  const b = readFileSync(path)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

if (!has('no-check')) {
  const { w, h } = pngSize(inPath)
  if (w !== W || h !== H) {
    die(
      `Input is ${w}×${h}, expected ${W}×${H}.\n` +
        `  Capture on an iPhone 17 Pro Max simulator, which is natively this size — anything else is\n` +
        `  resampled and Apple's reviewers see the softness. Pass --no-check to override.`,
    )
  }
}

const dir = mkdtempSync(join(tmpdir(), 'skipper-shot-'))
const htmlPath = join(dir, 'frame.html')
writeFileSync(htmlPath, html)

const res = spawnSync(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--screenshot=${outPath}`,
    `--window-size=${W},${H}`,
    // Fonts are embedded, so there is nothing to fetch — but Chrome still needs a beat to lay out and
    // decode a multi-megabyte data URI, and without this it can shoot an empty frame.
    '--virtual-time-budget=4000',
    `file://${htmlPath}`,
  ],
  { encoding: 'utf8' },
)
if (res.status !== 0) die(`Chrome failed:\n${res.stderr?.slice(0, 600)}`)
if (!existsSync(outPath)) die('Chrome reported success but wrote no file.')

const out = pngSize(outPath)
if (out.w !== W || out.h !== H) die(`Output is ${out.w}×${out.h}, expected ${W}×${H}.`)
console.log(`✓ ${outPath} — ${out.w}×${out.h}, palette + type from ${TOKENS}`)
