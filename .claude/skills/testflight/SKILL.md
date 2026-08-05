---
name: testflight
description: Use to ship an iOS build to TestFlight — the pre-flight that stops a wasted build, the EAS build itself, and the App Store Connect read-back that proves a tester can actually install it. For "ship a testflight build", "cut a build", "another testflight", "push a build to testers".
---

# TestFlight

Ships `apps/mobile` to TestFlight via EAS, and then proves it landed.

## Iron Law

**A build is not shipped because `eas build` exited 0.** That exit code means the
CLI finished talking to Expo. It does not mean Apple accepted the binary — ASC
can still reject it during processing, and the CLI has already gone home. Only
App Store Connect reporting `processingState=VALID` and
`internalBuildState=IN_BETA_TESTING` proves a tester can install it. Phase 4 is
not optional bookkeeping; it is the only phase that answers the question asked.

## The facts you need

| Thing | Value |
|---|---|
| CLI | `eas-cli@20.1.0`, installed under **nvm** — NOT on the default PATH |
| PATH fix | prefix commands with `PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"` |
| Project | `@manoa-inc/skipper` · bundle `fm.skipper.app` · ASC app `6778946770` |
| Build cmd | `bun run testflight` in `apps/mobile` (= `eas build --platform ios --profile production --auto-submit`) |
| Build number | **EAS owns it** — `appVersionSource: remote` + `autoIncrement` in `apps/mobile/eas.json` |
| Version string | `expo.version` in `apps/mobile/app.json` |

Credentials (distribution cert, provisioning profile, the ASC API key that makes
`--auto-submit` work) all live on EAS servers. You need none of them locally, and
you should not go looking — `eas credentials` is interactive and will hang.

## Phase 0: The two preconditions that abort or waste a build

**1. Is the CLI reachable?** `eas` alone is `command not found` in this shell.
Use the PATH prefix above on every invocation.

**2. Is the git tree clean?** This is the one that stops most attempts.
`eas build` calls `ensureRepoIsCleanAsync`, so:

- with `--non-interactive`, a dirty tree **hard-aborts before the build queues**;
- without it, the only "proceed" branch runs `commitAllFiles: true` — a
  `git commit -a`, which the root `CLAUDE.md` forbids outright on this shared
  tree. **Never answer that prompt.** It would pocket every other agent's
  uncommitted work into your commit.

```bash
git status --porcelain    # empty = clean
```

If it is dirty **with your own finished work**, commit it by explicit path first
(see the `ship` skill). If it is dirty with **another agent's in-flight work**,
do not touch it — go to "Shipping from a dirty tree" below.

## Phase 1: Pre-flight — cheap checks before a build

A build costs real minutes and consumes a build number forever. Spend two
minutes here first.

```bash
cd apps/mobile && bun run check          # tokens + eslint + typecheck + tests
```

Then prove Metro can actually bundle what you are about to ship. This is the
closest local proxy for the cloud build succeeding, and it catches module
resolution breakage that `tsc` cannot see:

```bash
bunx expo export -p ios --output-dir "$TMPDIR/skipper-export"
```

⚠ **Export outside the repo.** The default `dist/` lands untracked in the working
tree and dirties it — which then blocks the very build you are preparing.

If you touched dependencies, also run `bun run doctor` and **read the version
table, not the duplicate warning**: the "node_modules may be corrupted / multiple
copies" failure is a known false positive against bun's isolated linker, and
`apps/mobile/CLAUDE.md` documents it as such.

## Phase 2: Ship

```bash
cd apps/mobile
PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" \
  eas build --platform ios --profile production --auto-submit --non-interactive
```

Run it **backgrounded** — it waits for the build and then for the submission, and
that can be minutes or hours depending on queue depth.

⚠ **Never run an `eas` command from the repo root.** `apps/mobile` is the Expo
project; from the root, eas-cli decides there is no project and writes a stub
`{"expo": {}}` app.json at the top level. That file is untracked junk, it dirties
the tree, and it confuses Expo tooling that finds it first. If you see a root
`app.json` appear, you did this — delete it.

## Phase 3: Read the build number back

**Never assume the number.** `autoIncrement` assigns it when the build is
**queued**, not when it succeeds, so a failed or cancelled attempt consumes one
forever. The history has a gap at 17 and 18 for exactly this reason.

```bash
cd apps/mobile
PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" \
  eas build:list --platform ios --limit 1 --non-interactive
```

Check three things in that output: `Status finished`, the `Build number`, and the
`Commit` — the commit must be the one you meant to ship. Note the `Fingerprint`
too: it changes only when the **native** dependency set changes, so an unchanged
fingerprint across a dependency bump means the bump did not actually reach the
binary.

## Phase 4: Prove it reached TestFlight

The Iron Law lives here. `eas` reports "Submitted your app to App Store Connect"
the moment the upload finishes — Apple then processes for 5–10 minutes and can
still reject. Ask ASC directly:

```bash
dotenvx run -f .env.development --quiet -- bun .claude/skills/testflight/asc-builds.ts
```

It is read-only and writes nothing. You want your build listed with:

- `processing=VALID` — Apple accepted the binary
- `internal=IN_BETA_TESTING` — internal testers can install it now
- `encryption=false` — export compliance already answered, so no manual gate

A build that does not appear at all is still processing. Poll for it rather than
declaring success; **absence of a failure is not success.**

## Shipping from a dirty tree (another agent's uncommitted work)

The mobile artifact does not depend on `apps/api`, `apps/admin` or
`packages/studio`, but eas-cli's clean-tree check is blanket. When the tree is
dirty with work that is not yours and you cannot wait, build from a **detached
worktree of HEAD** — it is pristine, so eas-cli is satisfied, and the other
agent's files are never read, moved, or uploaded.

```bash
HEAD_SHA=$(git rev-parse HEAD)
git worktree add --detach "$TMPDIR/ship" "$HEAD_SHA"
cd "$TMPDIR/ship" && bun install --frozen-lockfile
```

Then run Phase 2 from `"$TMPDIR/ship/apps/mobile"`, and afterwards:

```bash
git worktree remove --force "$TMPDIR/ship" && git worktree prune
```

⚠ `--detach` creates **no branch**, so this does not violate the root
`CLAUDE.md` rule against creating or switching branches. Put the worktree
outside the repo, and confirm `git status` in the main tree is untouched when you
are done. **Ask the founder before taking this route** — it is a deliberate
workaround, not the default path.

## Traps

- **Timing is queue depth, not build time.** Builds 19 and 20 took ~3.5 hours;
  build 21, from the same config, took **6.5 minutes**. Almost all of that was
  waiting in Expo's queue. Do not quote an ETA from the last build.
- **A build that dies at "Run fastlane" with no error is usually not the app.**
  Build 17 died on a PostHog dSYM upload conflict (`content_hash_mismatch`) under
  the useless banner `EAS_BUILD_UNKNOWN_FASTLANE_ERROR`. The fix is already in
  (`skipOnConflict: true` on the posthog plugin in `apps/mobile/app.json`). Read
  the **Xcode logs**, not the EAS summary — and they are brotli-encoded, so
  `curl --compressed` fails and you need `brotli -dc`.
- **`ios/` is gitignored prebuild output.** EAS prebuilds fresh in the cloud, so
  a native rebuild owed after a dependency bump is discharged by the build
  itself. Nothing is owed locally.
- **EAS status.** Expo posts partial outages in the CLI banner and at
  status.expo.dev. If a build fails somewhere structurally weird, check that
  before suspecting the code.

## Reporting

Give the founder the build number, the version, the commit, and the ASC state in
plain English — plus the two links (build logs, submission). If it failed, say
which build number was consumed, because the next attempt will not reuse it.

For what to do with the build once testers have it, the on-device sweep and the
App Review walk live in `docs/guides/1-1-submission-sweep.md`; every listing
field is owned by `docs/guides/app-store-submission.md`. Tester feedback comes
back through `bun run tf:feedback`.
