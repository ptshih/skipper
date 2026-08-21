# Riders are real — the post-launch storage & wire posture

**Status:** ✅ **DECIDED 2026-08-21 (founder), effective from the 2026-08-20 release.** Supersedes the
2026-07-31 "storage is break-freely again" call; CLAUDE.md's posture bullet was rewritten in the same
change. Append here rather than editing history.

## What changed

1.1.0 went `READY_FOR_SALE` on 2026-08-20 — the App Store listing is public
(`apps.apple.com/us/app/skipper-road-trip-audio-tours/id6778946770`). From that moment a stranger can
create an account, receive the signup credit grant, spend a credit, and save a drive. Every one of
those is a real person's row in the one shared Neon DB.

## The decision

Founder picked the **riders-are-real posture** (2026-08-21, chosen over "snapshot-gated destructive
freedom" and "decide later"):

- **Migrations default to ADDITIVE.** Anything destructive — drops, truncates, `db:push` against a
  changed schema — needs an explicit founder go **plus** a fresh snapshot taken first.
- **The corpus snapshot does not cover rider data.** `snapshot-corpus` captures the content tables;
  `user` / `drives` / `credit_entries` (and the rest of the auth pool) are not in it, so "a snapshot
  exists" is NOT sufficient cover for destructive work touching rider rows. There is currently no
  rider-data snapshot tool — destructive work there is effectively off the table until one exists.
- **The wire contract now owes the shipped 1.1.0 client.** Breaking a DTO or route strands live apps
  mid-drive. The `/version` floor stays the one deliberate hard-break hatch
  (`docs/decisions/api-versioning-posture.md`) — raising it is a founder decision.
- **Unchanged, and sharper than ever:** `.env.development` and `.env.production` point at the SAME
  Neon DB and R2. There is no staging. `db:push` and `dev:admin` (`ADMIN_DEV_BYPASS=1`, full delete
  authority) aim at production despite the "development" label.

## Why the old call existed, and why it ended

The 2026-07-31 call ("1.0 will probably never be released, so we owe stored data nothing") was the
correct trade for a pre-launch rebuild window: it let 1.1 do destructive corpus migrations without
ceremony. Its own text named its premise, and the release killed the premise. This record is the
history CLAUDE.md's doctrine says a superseded rule gets.
