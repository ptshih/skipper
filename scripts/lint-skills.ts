#!/usr/bin/env bun
// Lints .claude/skills/**/SKILL.md. Run: `bun run lint:skills` (also in `bun run check`).
//
// Skills are a fifth category of documentation, and the only one nothing was
// watching: lint:docs sees docs/ + CLAUDE.md + TODO.md, and .claude/skills/ is
// none of those. They cite hard facts that move — service names, script names,
// file paths — and a skill that names something deleted sends an agent looking
// for it.
//
// Why this is STRICTER than lint:docs, and why it is a separate linter: a doc
// may legitimately reference a deleted path, because a decision record's job is
// to say what was removed (22 such references exist in docs/ and every one is
// correct). A skill has no historical mode — it instructs an agent about how to
// work NOW — so for skills, "referenced path must exist" is a real invariant.
//
// Checks: frontmatter name + description; name matches the directory (the slash
// command resolves by directory); every backticked repo path exists; every
// `bun run <script>` resolves in some package.json.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SKILLS_DIR = join(ROOT, '.claude', 'skills')

// A placeholder is prose, not a path — `docs/designs/<slug>.md` names a
// convention the skill is telling the agent to follow, not a file to open.
const PLACEHOLDER = /[<>*…{}]|\.\.\./

const violations: string[] = []

function scriptNames(): Set<string> {
  const names = new Set<string>()
  const manifests = [join(ROOT, 'package.json')]
  for (const group of ['apps', 'packages']) {
    const dir = join(ROOT, group)
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) manifests.push(join(dir, entry, 'package.json'))
  }
  for (const manifest of manifests) {
    if (!existsSync(manifest)) continue
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      for (const name of Object.keys(pkg.scripts ?? {})) names.add(name)
    } catch {
      // A malformed package.json is someone else's lint to fail, not this one's.
    }
  }
  return names
}

const KNOWN_SCRIPTS = scriptNames()

if (!existsSync(SKILLS_DIR)) {
  console.log('lint:skills — OK (no .claude/skills yet)')
  process.exit(0)
}

const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

for (const dir of skillDirs) {
  const rel = `.claude/skills/${dir}/SKILL.md`
  const file = join(SKILLS_DIR, dir, 'SKILL.md')
  if (!existsSync(file)) {
    violations.push(`${rel}: directory has no SKILL.md`)
    continue
  }
  const body = readFileSync(file, 'utf8')

  // 1 + 2. Frontmatter. The name must match the directory because that is what
  // the slash command resolves against — a mismatch makes the skill uninvokable
  // under the name it advertises.
  const fm = /^---\n([\s\S]*?)\n---/.exec(body)?.[1] ?? ''
  const name = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim()
  const description = /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim()
  if (!name) violations.push(`${rel}: no \`name:\` in frontmatter`)
  else if (name !== dir) violations.push(`${rel}: name \`${name}\` != directory \`${dir}\``)
  if (!description) violations.push(`${rel}: no \`description:\` in frontmatter — it is how the skill gets found`)

  // 3. Referenced repo paths must exist.
  for (const match of body.matchAll(/`((?:apps|packages|scripts|docs)\/[^`\s]+)`/g)) {
    const path = match[1]!.replace(/[.,;:)]+$/, '')
    if (PLACEHOLDER.test(path)) continue
    if (!existsSync(join(ROOT, path))) violations.push(`${rel}: references missing path \`${path}\``)
  }

  // 4. Referenced scripts must exist.
  for (const match of body.matchAll(/bun run ([a-z0-9:_-]+)/g)) {
    const script = match[1]!
    if (!KNOWN_SCRIPTS.has(script)) violations.push(`${rel}: \`bun run ${script}\` is not a script in any package.json`)
  }
}

if (violations.length > 0) {
  console.log(`lint:skills — ${violations.length} violation(s):\n`)
  for (const v of violations) console.log(`  ✗ ${v}`)
  console.log(
    '\n  A skill instructs an agent about how to work NOW, so a name it cites must resolve.\n' +
      '  Fix the reference, or drop it — do not add a historical caveat the way a doc would.',
  )
  process.exit(1)
}

console.log(`lint:skills — OK (${skillDirs.length} skills)`)
