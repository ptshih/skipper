#!/usr/bin/env bun
// PreToolUse hook (matcher: Bash) — wired in .claude/settings.json.
// Turns the CLAUDE.md STOP list from prose an agent can skim past into a
// mechanical gate. Two tiers, per the founder call (2026-08-03):
//
//   deny — the "NEVER" list. The tree AND the git index are shared across
//          agents, so these silently eat other agents' uncommitted work. Not
//          overridable by the agent; the human can still run them from their
//          own shell, which is the point — the rule binds agents, not people.
//   ask  — spend and one-way doors. A founder "go" IS an in-session yes, so
//          these escalate to a prompt instead of blocking.
//
// Fails OPEN on any plumbing error: a broken guard must never wedge the repo.
// Adding a rule here is cheaper than re-litigating a STOP violation, but every
// rule must trace to a line in CLAUDE.md — this file is not a second doctrine.

type Tier = 'deny' | 'ask'
type Rule = {
  re: RegExp
  tier: Tier
  why: string
  exempt?: RegExp
  // Claude Code already prompts for these in the default permission mode, and a
  // second prompt for the same action just trains click-through — the habit the
  // deny tier exists to prevent. So they stay silent there and fire only when
  // the built-in gate is relaxed (acceptEdits / bypassPermissions / dontAsk),
  // which is exactly where an ungated push or delete would otherwise slip by.
  whenPermissive?: boolean
}

// 'plan' executes nothing, so it needs no guard of its own.
const PERMISSIVE_MODES = new Set(['acceptEdits', 'bypassPermissions', 'dontAsk'])

// Anchored on `git` etc. so a match inside a commit message or a filename does
// not fire. Each segment is tested separately (see splitSegments), so a rule
// never needs to reason about `&&` chaining.
const RULES: Rule[] = [
  // ---- deny: CLAUDE.md "NEVER" list (shared tree / shared index) ----
  {
    re: /\bgit\s+stash\b(?!\s+(?:list|show)\b)/,
    tier: 'deny',
    why: 'One `git stash` pockets every agent\'s uncommitted work in the shared tree.',
  },
  {
    re: /\bgit\s+reset\b[^\n]*?--hard\b/,
    tier: 'deny',
    why: '`git reset --hard` discards uncommitted work belonging to other agents.',
  },
  {
    re: /\bgit\s+checkout\s+(?:--\s+)?\.(?:\s|$)/,
    tier: 'deny',
    why: '`git checkout -- .` reverts the whole shared tree, not just your files.',
  },
  {
    re: /\bgit\s+restore\b[^\n]*?(?:^|\s)\.(?:\s|$)/,
    tier: 'deny',
    why: '`git restore .` reverts the whole shared tree, not just your files.',
  },
  {
    // `-n` / `--dry-run` only lists what would go; nothing to guard.
    re: /\bgit\s+clean\b(?![^\n]*(?:-[A-Za-z]*n\b|--dry-run\b))/,
    tier: 'deny',
    why: '`git clean` deletes untracked files other agents have not committed yet.',
  },
  {
    // The escape hatches are the opposite of a rewrite — `--abort` undoes one.
    // Denying the way out of a bad state is backwards, and blocks recovery
    // precisely when the tree is already in trouble.
    re: /\bgit\s+rebase\b(?!\s+--(?:abort|continue|skip|quit)\b)/,
    tier: 'deny',
    why: 'Rebase rewrites shared history and can strand other agents mid-change.',
  },
  {
    re: /\bgit\s+add\s+(?:-A\b|--all\b|\.(?:\s|$))/,
    tier: 'deny',
    why: 'Stage by explicit path. `git add -A` sweeps up other agents\' files.',
  },
  {
    re: /\bgit\s+commit\b[^\n]*?(?<![\w-])(?:--all|-[A-Za-z]*a[A-Za-z]*)(?![\w-])/,
    tier: 'deny',
    why: 'Commit atomically by explicit path. `git commit -a` commits other agents\' work.',
  },
  {
    re: /\bprettier\b[^\n]*?--write\s+\.(?:\s|$)/,
    tier: 'deny',
    why: 'No repo-wide auto-fixers — rewrite by explicit path only.',
  },
  {
    // `bun run format` IS repo-wide `prettier --write` under another name; a
    // deny rule you can walk around by spelling it differently is not a guard.
    // `format:check` is read-only, hence the lookahead.
    re: /\brun\s+format(?!:)/,
    tier: 'deny',
    why: 'No repo-wide auto-fixers — `bun run format` rewrites every file in the shared tree.',
  },
  {
    // The no-slash lookahead sits immediately after `eslint` so a path-scoped
    // fix (`eslint apps/mobile/src --fix`) is allowed and only the repo-wide
    // form is denied.
    re: /\beslint\b(?![^\n]*\/)[^\n]*?--fix(?![\w-])/,
    tier: 'deny',
    why: 'No repo-wide auto-fixers — `eslint --fix` must target an explicit path.',
  },

  // ---- ask: spend, prod-aimed, and one-way doors ----
  {
    re: /(?<![\w-])--apply(?![\w-])/,
    tier: 'ask',
    why: 'SPENDS real GCP credits. A paid run needs an explicit founder "go", never inferred.',
  },
  {
    re: /\b(?:db:push|drizzle-kit\s+push)\b/,
    tier: 'ask',
    why: 'drizzle-kit push DROPS to match the schema — and dev/prod share ONE Neon DB.',
  },
  {
    re: /\bdev:(?:api|admin|site)\b/,
    tier: 'ask',
    why: 'The human keeps dev servers running continuously; do not boot or restart them. (dev:admin is also unauthenticated with full delete authority against prod.)',
  },
  {
    re: /\bgit\s+push\b/,
    tier: 'ask',
    why: 'A push deploys the API at 100% with no canary. Ask first.',
    whenPermissive: true,
  },
  {
    // Listed before the branch rule so a file-looking argument gets the honest
    // reason. `git checkout -- .` is denied outright by a rule above.
    re: /\bgit\s+checkout\s+(?:--\s+)?\S*\.\w{1,5}(?:\s|$)/,
    tier: 'ask',
    why: 'This reverts that file\'s uncommitted changes — make sure they are yours.',
  },
  {
    re: /\bgit\s+(?:switch|checkout)\s+(?:-c\b|-b\b|-{0,2}[A-Za-z][\w./-]*)/,
    tier: 'ask',
    why: 'Never create or switch branches without confirming — multiple agents share this tree.',
  },
  {
    re: /\bgcloud\s+(?:run\s+(?:jobs\s+execute|deploy)|builds\s+submit)\b/,
    tier: 'ask',
    why: 'SPENDS real GCP credits and can deploy. Needs an explicit founder "go".',
  },
  {
    re: /\brm\s+-[A-Za-z]*[rR][A-Za-z]*f|\brm\s+-[A-Za-z]*f[A-Za-z]*[rR]/,
    tier: 'ask',
    why: 'Recursive force delete.',
    whenPermissive: true,
    // Build artifacts are safe to blow away and are the overwhelming majority
    // of legitimate `rm -rf` here; exempting them keeps the prompt meaningful.
    // Dot-prefixed names need their own alternative: `\b` cannot match between
    // a `/` and a `.`, so `\b\.expo` would never fire on `apps/mobile/.expo`.
    exempt: /(?:\b(?:node_modules|dist|build|coverage)|(?:^|[\s/=])\.(?:turbo|next|expo|cache))\b/,
  },
]

// Commands that take code as a quoted argument. For these, quoted text IS
// executed, so it must stay visible to the rules.
const EVAL_LIKE =
  /\b(?:ba|z|k)?sh\s+-[A-Za-z]*c\b|\b(?:node|bun|deno)\s+-e\b|\bpython3?\s+-c\b|\beval\s|\b(?:ba|z|k)?sh\s+[^\n]*<</

// Everywhere else, quoted text is data — a commit message, a grep pattern, a
// heredoc of docs, a JSON test fixture. Blanking it out is what keeps the guard
// from firing on a command that merely *mentions* a blocked pattern. (Found the
// hard way: `echo '{"command":"git add -A"}' | bun guard-hook.ts` was denied.)
// Single quotes first — inside them, double quotes are literal.
function stripQuoted(command: string): string {
  return command.replace(/'[^']*'/g, ' ').replace(/"(?:\\.|[^"\\])*"/g, ' ')
}

// Heredoc bodies are data too — and they must be blanked BEFORE quote
// stripping, not left to it: a commit message containing its own quotes ends
// the quoted span early and leaks the rest of the body to the rules. Found the
// hard way — the commit introducing this guard was blocked by it, because the
// message explains which repo-wide auto-fixer the guard denies. A guard nobody
// can write a commit message about is a guard people route around.
function stripHeredocs(command: string): string {
  return command.replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1[\s\S]*?^[ \t]*\2[ \t]*$/gm, ' ')
}

// Split on shell separators so `cd apps/api && git stash` is caught. Rules are
// written per-command, so over-splitting can only lose a match that spans a
// separator — none do.
function splitSegments(command: string): string[] {
  const normalized = EVAL_LIKE.test(command) ? command : stripQuoted(stripHeredocs(command))
  return normalized.split(/&&|\|\||[;\n|]/)
}

export function classify(command: string, permissive = false): { tier: Tier; why: string } | null {
  let asked: { tier: Tier; why: string } | null = null
  for (const segment of splitSegments(command)) {
    for (const rule of RULES) {
      if (rule.whenPermissive && !permissive) continue
      if (!rule.re.test(segment)) continue
      if (rule.exempt?.test(segment)) continue
      // deny wins outright; keep scanning only to see if something worse shows up.
      if (rule.tier === 'deny') return { tier: 'deny', why: rule.why }
      asked ??= { tier: 'ask', why: rule.why }
    }
  }
  return asked
}

/** The rule table's verdict for one command. Exported for scripts/guard-hook.test.ts. */
export function decide(command: string, permissive = false): Tier | 'allow' {
  return classify(command, permissive)?.tier ?? 'allow'
}

function emit(decision: Tier, reason: string): never {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  )
  process.exit(0)
}

// Guarded so the rule table can be imported by the test without this reading
// stdin (which would hang the test runner).
if (import.meta.main) {
  try {
    const input = await Bun.stdin.text()
    let command = ''
    let permissive = false
    try {
      const parsed = JSON.parse(input)
      if (parsed?.tool_name !== 'Bash') process.exit(0)
      command = parsed?.tool_input?.command ?? ''
      permissive = PERMISSIVE_MODES.has(parsed?.permission_mode ?? 'default')
    } catch {
      process.exit(0)
    }
    if (!command) process.exit(0)

    const hit = classify(command, permissive)
    if (!hit) process.exit(0)

    if (hit.tier === 'deny') {
      emit(
        'deny',
        `BLOCKED by skipper-guard (CLAUDE.md STOP list). ${hit.why}\n` +
          'Not overridable by an agent. Commit atomically by explicit path instead; ' +
          'if you genuinely need this, ask the human to run it in their own shell.',
      )
    }
    emit('ask', `skipper-guard: ${hit.why}`)
  } catch {
    // Never let hook plumbing break an unrelated tool call.
    process.exit(0)
  }
}
