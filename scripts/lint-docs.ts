#!/usr/bin/env bun
// Enforces the docs/ truth-system structure (conventions: docs/README.md).
// Checks: kind folders only; a **Status** line per doc; no *-handoff.md files
// (handoffs are ephemeral); no bare docs/<file>.md paths (files live in kind
// folders); CLAUDE.md stays lean. Run: `bun run lint:docs` (also in `bun run check`).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const KINDS = ['decisions', 'designs', 'research', 'guides']
const STATUS_WINDOW_LINES = 12
// Raised 320 -> 340 on 2026-07-31, deliberately. The 1.1 rewrite ADDED four invariants that each
// prevent a verified production defect (rider-triggered spend caps, the anonymous row deleted at link,
// the wire-enforced anchor allowlist, two non-interchangeable persona prompts) while roam's removal
// only shrank the file ~10 lines. Absorbing them by compressing prose was making the sentences worse,
// which defeats the point of a file agents must read correctly. Raise it again only for the same
// reason: a NEW rule that prevents breakage or spend — never to park an essay here.
const CLAUDE_MD_CEILING = 340

const errors: string[] = []

// 1. Folders by kind: nothing loose at docs/ root except README.md.
const docsDir = join(ROOT, 'docs')
for (const entry of readdirSync(docsDir)) {
  if (entry === '.DS_Store') continue
  if (statSync(join(docsDir, entry)).isDirectory()) {
    if (!KINDS.includes(entry))
      errors.push(
        `docs/${entry}/: unknown folder — docs/ folders are ${KINDS.join(', ')}. ` +
          `Adding a kind is fine, but do it deliberately: update KINDS here + docs/README.md.`,
      )
  } else if (entry !== 'README.md') {
    errors.push(
      `docs/${entry}: loose file at docs/ root — file it under docs/<kind>/ (${KINDS.join('/')}); see docs/README.md`,
    )
  }
}

// 2 + 3. Per-doc: a **Status** line near the top; no handoff docs.
for (const kind of KINDS) {
  const dir = join(docsDir, kind)
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    const rel = `docs/${kind}/${f}`
    if (/-handoff\.md$/.test(f))
      errors.push(`${rel}: handoff docs are ephemeral — delete once consumed (durable rationale belongs in docs/decisions/)`)
    const head = readFileSync(join(dir, f), 'utf8')
      .split('\n')
      .slice(0, STATUS_WINDOW_LINES)
      .join('\n')
    if (!/\*\*Status/.test(head))
      errors.push(
        `${rel}: no **Status** line in the first ${STATUS_WINDOW_LINES} lines — every doc opens with a dated status note (see docs/README.md)`,
      )
  }
}

// 4. No bare docs/<file>.md references anywhere (tracked + untracked-unignored
// text files): after the 2026-06-09 reorg, every docs file lives in a kind folder.
const ls = Bun.spawnSync(
  ['git', 'ls-files', '-co', '--exclude-standard', '--', '*.md', '*.ts', '*.tsx'],
  { cwd: ROOT },
)
const files = ls.stdout.toString().split('\n').filter(Boolean)
const BARE = /docs\/([A-Za-z0-9._-]+\.md)/g
for (const rel of files) {
  const path = join(ROOT, rel)
  if (!existsSync(path)) continue // deleted in working tree but still tracked
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(BARE)) {
        if (m[1] === 'README.md') continue
        errors.push(`${rel}:${i + 1}: bare path "docs/${m[1]}" — docs files live in kind folders (docs/<kind>/<file>.md)`)
      }
    })
}

// 5. CLAUDE.md size ratchet: operating truth only.
const claudeLines = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8').split('\n').length
if (claudeLines > CLAUDE_MD_CEILING)
  errors.push(
    `CLAUDE.md is ${claudeLines} lines (ceiling ${CLAUDE_MD_CEILING}) — it's operating truth only: move essays to docs/designs/, ` +
      `superseded text to docs/decisions/. (Or consciously raise CLAUDE_MD_CEILING in scripts/lint-docs.ts.)`,
  )

if (errors.length) {
  console.error(`lint:docs — ${errors.length} violation(s) of the docs truth system (docs/README.md):\n`)
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log(`lint:docs — OK (${KINDS.length} kind folders, CLAUDE.md ${claudeLines}/${CLAUDE_MD_CEILING} lines)`)
