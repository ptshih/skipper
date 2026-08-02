// ESLint for apps/mobile — adopted 2026-08-02 for ONE rule above all others.
//
// WHY HERE AND NOT REPO-WIDE: this workspace is unusually hook- and ref-heavy. `useDrive` alone owns
// ~10 refs, several interacting effects, a fire-queue and two watchdogs; `useRoutePreview` and
// `useStopPreview` are the same shape. A stale closure in a GPS-and-audio state machine does not fail
// a typecheck and does not fail a unit test — the hooks are the one part of this app that
// `bun test` structurally cannot reach (they import expo-audio, so they can't run under bun; see
// apps/mobile/CLAUDE.md). It fails in a moving car. `react-hooks/exhaustive-deps` is the only tool in
// the stack that reads that code at all.
//
// WHY eslint-config-expo SPECIFICALLY: it is Expo's documented setup
// (https://docs.expo.dev/guides/using-eslint/), it is versioned in lockstep with the SDK
// (57.x here, matching expo ~57), and its stated philosophy is to "focus on code correctness and
// avoid stylistic rules that can be subjective". That last part is why it is tolerable in THIS repo:
// the dense decision-journal comment style is deliberate and load-bearing (root CLAUDE.md), and a
// formatter-shaped linter would spend its life fighting it. Correctness rules only.
//
// ⚠ NOT a formatter and must not become one. There is no prettier here on purpose. If a rule ever
// starts rewriting prose, comments or import order, turn the rule off rather than reformatting the
// repo — a repo-wide auto-fixer is banned outright (root CLAUDE.md, shared working tree).
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  {
    // Build output, native projects and the Expo cache are generated — never ours to lint.
    // `.expo/types` in particular is codegen that legitimately breaks rules we enforce on source.
    ignores: ['dist/*', '.expo/*', 'ios/*', 'android/*', 'expo-env.d.ts'],
  },
])
