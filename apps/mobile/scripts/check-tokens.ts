#!/usr/bin/env bun
// Token-discipline gate. Fails if a SCREEN (app/) or UI primitive (src/ui/) hardcodes
// a color or font instead of going through the theme. Keeps DESIGN.md's "components
// reference semantic roles, never raw values" enforced as new screens land, instead of
// relying on review discipline (the review found exactly this kind of drift). Raw
// palette / rgba / font NAMES live in src/theme ONLY, which these dirs exclude.
//
// Run: bun scripts/check-tokens.ts   (wired as `bun run lint:tokens`)
import { Glob } from 'bun'

const ROOT = new URL('..', import.meta.url).pathname // apps/mobile/
const DIRS = ['app', 'src/ui']
const RULES: { re: RegExp; what: string }[] = [
  { re: /#[0-9a-fA-F]{3,8}\b/, what: 'raw hex color — use a theme token (e.g. color="ink")' },
  { re: /\brgba?\s*\(/, what: 'raw rgb/rgba color — add a semantic role in theme.ts' },
  { re: /fontFamily:\s*['"`]/, what: 'raw fontFamily string — use a typeScale variant / fonts.*' },
]

const violations: string[] = []
for (const dir of DIRS) {
  for (const rel of new Glob('**/*.{ts,tsx}').scanSync({ cwd: ROOT + dir })) {
    const path = `${dir}/${rel}`
    const text = await Bun.file(ROOT + path).text()
    let inBlock = false
    text.split('\n').forEach((raw, i) => {
      let line = raw
      if (inBlock) {
        const end = line.indexOf('*/')
        if (end === -1) return // still inside a block comment
        line = line.slice(end + 2)
        inBlock = false
      }
      line = line.replace(/\/\*.*?\*\//g, '') // inline block comments
      const open = line.indexOf('/*')
      if (open !== -1) {
        inBlock = true
        line = line.slice(0, open)
      }
      const lc = line.indexOf('//') // line comment
      if (lc !== -1) line = line.slice(0, lc)
      for (const { re, what } of RULES) {
        if (re.test(line)) violations.push(`  ${path}:${i + 1}  ${what}\n      ${line.trim()}`)
      }
    })
  }
}

if (violations.length) {
  console.error(`\n✗ token-discipline: ${violations.length} hardcoded value(s) in app/ + src/ui:\n`)
  console.error(violations.join('\n'))
  console.error('\nMove the value into src/theme (a token / semantic role) and reference it.\n')
  process.exit(1)
}
console.log('✓ token-discipline: app/ + src/ui reference theme tokens (no raw hex/rgba/font).')
