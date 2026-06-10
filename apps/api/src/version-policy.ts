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
    // TODO(submission): replace the placeholder ID with the real App Store numeric ID
    // (https://apps.apple.com/app/id<ID>) once the app is submitted. Never opened while
    // the floor is a no-op, so the placeholder is harmless until then.
    storeUrl: 'https://apps.apple.com/app/id000000000',
  },
  {
    platform: 'android',
    minimum: '0.0.0',
    recommended: '0.0.0',
    storeUrl: 'https://play.google.com/store/apps/details?id=tours.skipper.app',
  },
]
