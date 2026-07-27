// Per-platform app-version policy, served by GET /version. The AUTHORITATIVE copy lives
// here (server-side) so the minimum/recommended floor is raised by a BACKEND deploy —
// never an App Store release. The client (apps/mobile VersionGate) reads its own version,
// compares via @skipper/shared `gateFor`, and shows a dismissible nudge or a blocking wall.
//
// SEEDED AT A NO-OP FLOOR (minimum === recommended === the shipping app.json version,
// "0.0.0") so it gates NOBODY until a floor is deliberately raised. When the app version
// is bumped for the first submission, raise these intentionally.

import type { VersionPolicy } from '@skipper/shared'

export const VERSION_POLICIES: VersionPolicy[] = [
  {
    platform: 'ios',
    minimum: '0.0.0',
    recommended: '0.0.0',
    // The real ASC app id (assigned when the app RECORD was created, long before any
    // release — same number as `submit.production.ios.ascAppId` in apps/mobile/eas.json).
    // Set deliberately AHEAD of the listing being public: this link is only ever opened
    // by the client's VersionGate, which can only fire once a floor above is raised, which
    // can only happen once there IS a published version to upgrade to. So it resolves by
    // construction at the only moment it's used — whereas the placeholder it replaced
    // would have deep-linked every iOS rider to a dead page the first time the one hard-
    // break hatch in the whole versioning posture was ever pulled.
    storeUrl: 'https://apps.apple.com/app/id6778946770',
  },
  {
    platform: 'android',
    minimum: '0.0.0',
    recommended: '0.0.0',
    storeUrl: 'https://play.google.com/store/apps/details?id=fm.skipper.app',
  },
]
