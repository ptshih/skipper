# Create-a-Drive verification runbook (V2)

**Status:** HISTORICAL — superseded by 1.1 on 2026-08-02 and the download-before-start
change on 2026-08-05. Condensed 2026-09-09; obsolete execution steps removed. This is a
record of verification questions, not an executable runbook or evidence of a completed drive.

## Why this exists

The original 2026-06-18 pass asked what typechecks cannot answer: does the proposed route make
sense, does its selection make a good drive, does audio trigger and recover on a phone, and can a
rider finish without a network? Those questions survive the deleted Create screen.

The replacement [1.1 submission sweep](1-1-submission-sweep.md) carried them forward into desk
and device passes. That sweep was discharged after submission; consult the current
[App Store record](app-store-submission.md) for release status. RISK-1's actual road drive remains
unrecorded there. Desk simulation does not establish real GPS, background behavior, or pacing in a car.

## Boundaries the old instructions must not restore

- The conversation replaced the FROM/TO pickers, and roam was removed. Anonymous riders can plan,
  propose, and hear a route-preview clip; account enforcement belongs on individual protected
  routes, not the entire `/drives` mount. See the [1.1 design](../designs/drives-first-1-1.md).
- Saved-drive audio resolves from disk. The remote playback/re-sign ladder was removed; the
  anonymous route-preview clip still streams before a drive exists. See
  [download-before-start](../designs/download-before-start.md).
- A drive's credit is not refunded by deleting it. Read the
  [credit-ledger decision](../decisions/credit-ledger.md) and implementation for balances and grants;
  the old corpus counts, cap values, and race assessments are not current evidence.
- This record authorizes no paid verification run. Follow [CLAUDE.md](../../CLAUDE.md) for operator
  spend and production rules; development and production share storage.

## Questions to carry into a current verification pass

- Does the proposed route match the request, with useful stops and sensible ordering? Exercise a
  sparse route, a round trip, and an off-list destination. Check empty-selection behavior before
  spending a credit; do not inherit the old geocoder or identical-endpoint loop assumptions.
- Does creation lead to the saved drive and start its download? Does the transfer survive leaving
  and reopening the screen, and does Start reflect the actual local copy?
- Does the detail mini-preview play a downloaded stop and explain a missing one? Does a fully saved
  drive reopen and complete with networking off?
- For an interrupted download, does the offline partial-copy path disclose missing stops? Does a
  drive with nothing saved explain why it cannot start? Use the download design for the exact gate.
- Do stops trigger, replay, and finish correctly? Judge pacing at real time: accelerated simulation
  compresses quiet road. Confirm the selected GPS mode so a supposed real drive is not simulated.
- Does a broken local clip skip after the intended wait? Do call/Siri/Bluetooth interruptions recover?
  A local-file player still needs post-start stall recovery; this was never only a streaming concern.
- Do ownership, exhausted-credit, and exit-confirmation cases behave correctly without exposing
  another rider's drive or unexpectedly ending playback?

## Historical findings and evidence limits

The original code pass flagged empty paid drives, degenerate loops, geocoder containment, and a
credit-consumption race. It also noted resolved V1 naming and future clip-form handling. These were
findings against the June implementation, not freshly verified defects. Consult current code and the
[API audit](../research/api-best-practices-audit.md) before treating any as open or resolved.

Its positive checks covered owner-scoped reads, selections drawn from the same corpus, and playback
watchdogs. They likewise do not substitute for a current code or device check. The
[device verification record](device-verification-runbook.md) preserves native risks, including the
local-decode timeout's need for a physical-device check.

The original steps and file coordinates remain in git history at this path.
