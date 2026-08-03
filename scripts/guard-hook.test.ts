// Regression tests for the STOP-list guard (scripts/guard-hook.ts).
// The guard is a table of regexes standing between an agent and other agents'
// uncommitted work, so both directions matter: a rule that stops firing is a
// hole, and a rule that over-fires blocks the prescribed workflow and teaches
// people to route around the guard. Both are represented below.
//
// Tests the rule table directly rather than spawning the hook: passing stdin to
// Bun.spawnSync behaves differently depending on where the test file lives
// (identical spawn returns the verdict from outside the repo, empty from
// scripts/), so a spawn-based test would assert the harness, not the rules. The
// stdin plumbing is the same shape as scripts/docs-hook.ts and is exercised for
// real on every Bash call.
//
// Wired into `bun run check` via the root `test:scripts` script — scripts/ is
// not a workspace, so `bun --filter '*' test` does not reach it.

import { describe, expect, test } from 'bun:test'
import { decide } from './guard-hook'

describe('deny — the CLAUDE.md NEVER list', () => {
  const cases = [
    'git stash',
    'cd apps/api && git stash push -m wip',
    'git reset --hard HEAD~3',
    'git checkout -- .',
    'git checkout .',
    'git restore .',
    'git restore --staged .',
    'git clean -fd',
    'git rebase main',
    'git add -A',
    'git add .',
    'git add --all',
    'git commit -am "wip"',
    'git commit -a',
    'prettier --write .',
    'bun run format',
    'eslint --fix',
    'bunx eslint . --fix',
  ]
  for (const command of cases) {
    test(command, () => expect(decide(command)).toBe('deny'))
  }
})

describe('ask — spend and one-way doors', () => {
  const cases = [
    'bun run studio enrich --apply',
    'bun packages/studio/src/generate-narrations.ts --apply',
    'bun run db:push',
    'bunx drizzle-kit push',
    'git switch -c feature/x',
    'git checkout -b feature/x',
    'git switch main',
    'git checkout apps/api/src/limits.ts',
    'gcloud run jobs execute generate --region us-east4',
    'gcloud builds submit',
    'bun run dev:admin',
  ]
  for (const command of cases) {
    test(command, () => expect(decide(command)).toBe('ask'))
  }
})

describe('allow — the prescribed workflow must never be blocked', () => {
  const cases = [
    'git commit apps/api/src/limits.ts docs/decisions/x.md -m "fix"',
    'git commit -m "add a thing"',
    'git add apps/api/src/limits.ts',
    'git stash list',
    'git status',
    'git diff --stat apps/api/src/limits.ts',
    'git log --oneline -20',
    'bun run check',
    'bun run lint',
    'bun run format:check',
    'eslint apps/mobile/src --fix',
    'rm -rf node_modules',
    'rm -rf apps/mobile/.expo',
    'bun run studio enrich',
    'lsof -nP -iTCP:8788 -sTCP:LISTEN',
  ]
  for (const command of cases) {
    test(command, () => expect(decide(command)).toBe('allow'))
  }
})

describe('quoted text is data, not a command', () => {
  // A guard that fires on a command merely *mentioning* a blocked pattern makes
  // documenting and testing the guard impossible.
  const allowed = [
    `echo '{"tool_input":{"command":"git add -A"}}' | bun scripts/guard-hook.ts`,
    'grep -rn "git stash" docs/',
    'git commit -m "document why git add -A is banned"',
  ]
  for (const command of allowed) {
    test(`allows: ${command}`, () => expect(decide(command)).toBe('allow'))
  }

  // ...but an eval genuinely executes its quoted payload.
  const denied = ['bash -c "git add -A"', "sh -c 'git reset --hard'"]
  for (const command of denied) {
    test(`denies: ${command}`, () => expect(decide(command)).toBe('deny'))
  }
})

test('deny wins over ask when a command chains both', () => {
  expect(decide('git push origin main && git stash')).toBe('deny')
})

describe('recovery and dry runs are not destructive', () => {
  // Denying the way out of a bad rebase blocks recovery exactly when the tree
  // is already in trouble.
  for (const command of [
    'git rebase --abort',
    'git rebase --continue',
    'git rebase --skip',
    'git rebase --quit',
    'git clean -n',
    'git clean --dry-run',
  ]) {
    test(command, () => expect(decide(command)).toBe('allow'))
  }

  test('the real thing is still denied', () => {
    expect(decide('git rebase main')).toBe('deny')
    expect(decide('git clean -fd')).toBe('deny')
  })
})

describe('rules that duplicate the built-in prompt', () => {
  // Silent in default mode (Claude Code already asks; a second prompt just
  // trains click-through), active where the built-in gate is relaxed.
  for (const command of ['git push origin main', 'rm -rf /tmp/scratch']) {
    test(`${command} — silent in default mode`, () => expect(decide(command)).toBe('allow'))
    test(`${command} — gated when permissive`, () => expect(decide(command, true)).toBe('ask'))
  }

  test('spend rules fire regardless of permission mode', () => {
    expect(decide('bun run studio enrich --apply')).toBe('ask')
    expect(decide('bun run studio enrich --apply', true)).toBe('ask')
  })

  test('the deny core is never mode-dependent', () => {
    expect(decide('git stash')).toBe('deny')
    expect(decide('git stash', true)).toBe('deny')
  })
})

describe('heredoc bodies are data', () => {
  // The commit that introduced this guard was blocked by it: the message
  // explains which auto-fixer is denied, and quotes inside the body ended the
  // quoted span early, leaking the rest to the rules.
  const message = [
    `git commit scripts/guard-hook.ts -m "$(cat <<'EOF'`,
    'feat(tooling): enforce the STOP list',
    '',
    'Denies the "NEVER" list, and `bun run format` because it is repo-wide',
    'prettier under another name. Also denies git add -A and git commit -a.',
    'EOF',
    ')"',
  ].join('\n')

  test('a commit message may describe what the guard blocks', () => {
    expect(decide(message)).toBe('allow')
  })

  test('but a heredoc fed to a shell still executes', () => {
    expect(decide("bash <<'EOF'\ngit stash\nEOF")).toBe('deny')
  })
})
