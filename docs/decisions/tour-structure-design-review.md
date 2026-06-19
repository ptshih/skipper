# Tour-structure design review — adversarial critique (TOMBSTONE)

**Status:** 🔴 **HISTORICAL — body excised 2026-06-19 (full text in git history).** A 2026-06-08
adversarial, pre-build pressure-test of the (since-deleted) tour-structure spec + handoff. The design
it critiqued is **fully deleted** — directionality, drive families, `corridors`, the `tour_brackets`/
`tour_frames` bracket pair (and the `asides` that briefly replaced them, dropped in migration `0019`),
`poi_content`, the `region` pgEnum — every axis it examined is gone. Nothing here is current; it is
retained only as a decision-history pointer.

**Live model:** `docs/decisions/create-a-drive-architecture.md` + `docs/decisions/geometry-first-regions.md`
(and `docs/decisions/tour-data-model-zero-reuse.md` for the zero-reuse principle's own history).

## What it was

- **Method:** 8 reviewer lenses (invariants · schema/migration · directionality · catalog/mobile ·
  persona-registry · intro/outro · narration-coherence · scale/staleness) fanned out over the docs vs.
  code; every finding got an independent skeptic that re-read the cited evidence to confirm/refute, then
  a synthesis + completeness-critic pass deduped and ranked. **62 agents.** Counts: 53 raised, 50
  survived, 3 refuted — 3 Blockers, 14 major, 18 minor, 17 nit. **Verdict:** `build-with-fixes`.
- **Outcome:** the design was then simplified into the zero-reuse model, and later the V2 roam +
  user-owned-drives model. Its one still-relevant finding that shipped — **M6**, the prompt/lint
  inversion ("1–2 best groaners per stop," not "three or four") — is DONE (commits `67e9313` / `7860b3f`).
  Every Blocker dissolved with the deleted design (B1/B2 the place-less bracket schema holes; B3 the
  reverse-polyline source — there is no "reverse," every drive is independent).

_The full 38 KB critique (all 50 findings + the per-finding skeptic verification + the methodology
write-up) is recoverable from git history; it is excised here because every design axis it reviewed no
longer exists, and append-only history is better served by a pointer than by a wall of dead analysis._
