# EAS setup — Skipper mobile (phone-player dev build)

How to build and run the Expo app (`apps/mobile`) on EAS, for the M1 live
phone-player work. Written 2026-06-08.

## TL;DR

```bash
# 1. add the dev-client package (run from apps/mobile)
cd apps/mobile && bunx expo install expo-dev-client

# 2. first build — iOS simulator (no Apple Developer account needed)
eas build --platform ios --profile development

# 3. install the finished build to a booted simulator
eas build:run -p ios --latest

# 4. start Metro + the API, then open the app
bun start                                   # in apps/mobile
cd ../.. && bun run dev                      # API on http://localhost:8787
```

---

## What's already done

- **`eas-cli 20.1.0`** installed.
- **Logged in** as `ptshih@gmail.com` (Owner on the `manoa-inc` org).
- **EAS project linked** — `@manoa-inc/skipper`, project id
  `5dded9ce-af00-4c5f-957d-52644d7ab155` (in `apps/mobile/app.json` under
  `extra.eas.projectId`, `owner: "manoa-inc"`).
- **`apps/mobile` installed** — Expo SDK 56.0.9 / RN 0.85.3, `expo-dev-client`
  already in `package.json`.
- **`apps/mobile/eas.json` created** with four build profiles:

  | profile              | what it builds                                   | needs Apple Dev acct? |
  |----------------------|--------------------------------------------------|:---------------------:|
  | `development`        | dev-client, **iOS simulator**, internal dist     | no                    |
  | `development-device` | dev-client, **real iPhone** (`extends` the above)| yes                   |
  | `preview`            | internal distribution                            | (device) yes          |
  | `production`         | store build, `autoIncrement`                     | yes                   |

  `cli.appVersionSource: "remote"` so EAS owns the build number.

---

## Step-by-step

### 1. Add the dev-client package

Dev builds need `expo-dev-client`. Run it yourself from `apps/mobile` (it edits
the shared `package.json` / `bun.lock`):

```bash
cd apps/mobile && bunx expo install expo-dev-client
```

### 2. First build — iOS simulator

The simulator profile is the fastest path and needs **no Apple Developer
account** (simulator builds are unsigned):

```bash
cd apps/mobile && eas build --platform ios --profile development
```

- Builds on EAS cloud (~10–20 min).
- The project is already linked, so it shouldn't re-prompt for project setup.
- No credentials prompt for a simulator build.

### 3. Install to the simulator

When the build finishes (or any time after):

```bash
cd apps/mobile && eas build:run -p ios --latest
```

This downloads the `.app` and installs it to the booted simulator.

### 4. Start Metro + the API

```bash
cd apps/mobile && bun start          # dev client connects to Metro
# in another shell, from the repo root:
bun run dev                          # API on http://localhost:8787 so the app has data
```

Open the installed **dev-client** app in the simulator; it connects to Metro and
loads the JS bundle.

---

## Real device (the actual drive test) — later

Needs an **Apple Developer Program** membership ($99/yr) under `manoa-inc` (or
personal), then:

```bash
cd apps/mobile && eas device:create                                    # register your iPhone (one-time)
cd apps/mobile && eas build --platform ios --profile development-device
```

Install via the QR code / link EAS hands back.

**One extra config for device:** the app reads `EXPO_PUBLIC_API_URL` and falls
back to `http://localhost:8787`, which a physical phone can't reach. Set it to
your Mac's LAN IP (e.g. `http://192.168.x.x:8787`) or a tunnel before the device
build, otherwise the app loads but gets no data.

---

## Watch-items (not blockers)

- **bun + EAS autolinking** is this repo's flagged "load-bearing unknown." EAS
  detects `bun.lock` and uses bun, but if a cloud build fails at the
  install/autolinking step, the documented fallback is to use **npm for
  `apps/mobile` only** (`rm bun.lock && npm install`) — the backend stays on
  bun. Don't do this preemptively; only if it fights.

- **Monorepo upload — already handled.** EAS `git clone`s the **whole repo** from
  the git root (and with the default `requireCommit: false` also copies
  uncommitted/untracked files), so `@skipper/shared`
  (`file:../../packages/shared`) ships with the upload and resolves on the
  builder — even though `apps/mobile` is deliberately kept out of the bun
  workspace. No action needed.

- **`.env.keys` stays local.** It's gitignored, so it is **not** uploaded — good
  (secrets stay off EAS). App-facing config comes from `EXPO_PUBLIC_*` env in
  `eas.json` / EAS secrets, not the decryption key.

- **Slimming the upload (optional).** A repo-root `.easignore` excluding
  `apps/api` + `packages/{db,generator,sim}` would shrink the upload. **Must not**
  exclude `packages/shared` — the build needs it. Left out for now to avoid that
  footgun.

- **Android anytime:** `eas build -p android --profile development` produces an
  apk for an emulator/device — no Apple constraints.
