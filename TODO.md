# TODO — engineering backlog

Carry-forward **engineering** items (the near-term layer of the truth system — see
`docs/README.md`; product ideas live in `docs/ideas/`, build-ready designs in `docs/specs/`).
Each item has enough context to action without re-deriving the reasoning. **Delete items
when done** — git history is the archive.

## API contract: pick a versioning posture BEFORE the first App Store submission

CLAUDE.md's **"break things freely"** doctrine is now explicitly scoped to STORAGE
(done 2026-06-09) — but the open decision remains: once the mobile app is in the App
Store, installed clients won't update instantly, so the **API / DTO contract
(`@skipper/shared` + `apps/api` routes) can no longer break freely** even though the DB
still can.

- [ ] Decide an **API-versioning posture BEFORE the first App Store submission**:
      - version the routes (`/v1/tours`) and/or the DTOs, and/or
      - keep N−1 compatibility for a deprecation window matched to app-update lag.
- Today there is no versioning (`/tours`, not `/v1/tours`) — fine pre-launch, a trap
  post-launch (an old installed app hitting a changed contract → silent breakage).

Refs: CLAUDE.md (top doctrine + Hard invariants), `packages/shared/src/schemas.ts`,
`apps/api/src/index.ts`.

## Cost guardrail on `generateTour`

The one stated operational risk is *"a live regen burns GCP credits"* (CLAUDE.md), yet
cost control is mostly human discipline (the "founder OK"). Partially addressed
(2026-06-09): the eval-driven regen loop is hard-capped (`EVAL_REGEN_BUDGET` +
per-pass/round caps in `config.ts`), so LLM re-narration spend is bounded per tour.
Still open:

- [ ] Print an **estimated spend** (LLM input/output tokens + TTS characters → rough $)
      BEFORE the TTS/R2 phase, so a full run shows its cost before paying for it.
- [ ] Optionally a `--max-cost` / `--max-tts-chars` abort, and/or a confirmation gate on a
      full (non-`--dry-run`) regen.
- Related robustness (compounds the cost win; promote to its own item if tackled): generation
  is **not resumable** and clip uploads are **not transactional** with the final `db.batch` —
  a crash mid-run wastes all prior LLM+TTS spend and can orphan R2 objects (no cleanup).
  Checkpointing synthesized clips and/or an orphan sweep would cap the blast radius.

Refs: `packages/generator/src/pipeline/generate.ts` (the narrate → TTS → upload loop +
the atomic ready-gate), `packages/generator/src/run.ts` (`--dry-run` already skips spend),
`packages/generator/src/pipeline/tts.ts`.

## R2 orphan sweep (cost cruft from regens)

Every successful regen orphans the previous telling's clips in R2: stop AND bracket keys
are per-run unique (deliberate — see `storage.ts`), so old objects under
`clips/<tourId>/…` are simply abandoned when `finalizeTourReady` replaces the rows. Known
+ accepted (private, unreferenced bytes), but it accrues. A small sweep tool — list
`clips/<tourId>/`, delete every key not referenced by a current `tour_stops.audioUrl` /
`tour_brackets.audioUrl` — caps it. Run it manually after blessed regens.

Refs: `packages/generator/src/pipeline/storage.ts` (`deleteAudio` exists),
2026-06-09 DB-write audit (verified-minor finding).

## Offline downloads never see patched clips

`patch-clip` re-synthesizes in place at the stored key, but a device that already
DOWNLOADED the tour keeps its local bytes forever — the exact bad word the tool fixed
stays on-device until the user manually re-downloads. Real fix is a manifest version (bump
on any clip update; the app re-fetches changed clips). Post-MVP; matters once strangers
hold offline tours.

Refs: `packages/generator/src/patch-clip.ts`, `apps/mobile/src/lib/offline.ts` (manifest),
2026-06-09 DB-write audit (verified-minor finding).
