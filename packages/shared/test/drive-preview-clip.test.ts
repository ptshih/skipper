import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { driveProposal, drivePreviewClip } from '../src/schemas'

// `previewClip` is the ANONYMOUS rider's one taste of the product (D14/INV-5): a single presigned clip
// drawn from an unauthenticated POST /drives/propose. Two properties have to survive future edits, and
// neither is enforceable by a comment:
//
//   1. IT IS AN OBJECT, NEVER A LIST. "Exactly one clip" is the SHAPE, not a server-side length check
//      someone can relax. `z.array(drivePreviewClip)` is one character away from the field below, and
//      it would typecheck, parse, and ship — turning a taste into bulk corpus egress for a caller who
//      pays nothing. The array test in this file is the thing standing in front of that.
//   2. IT CARRIES NO GEOMETRY AND NO CORPUS KEY. `driveClip` (the owner-side shape) has `subjectId`,
//      `lat`/`lng`, `triggerRadiusM`, `alongSec` and `seq`. Reusing it here would put exact trigger
//      geometry plus a stable key a stranger can correlate across routes on an open wire. The distinct
//      DTO is the guard; the key test below pins that it stays distinct.
//
// ⚠ The keys test asserts the SCHEMA's surface, not a parsed object — `z.object` strips unknown keys,
// so `parse()`ing a leaked payload would scrub the evidence and pass. The matching server-side
// assertion (that `previewClipFor` CONSTRUCTS nothing more) lives in apps/api's own suite; this file
// owns the wire contract only.

const clip = {
  name: 'Emerald Bay',
  url: 'https://r2.example.com/narrations/emerald-bay.m4a?X-Amz-Signature=deadbeef',
  contentType: 'audio/mp4',
  durationMs: 118_000,
  attribution: [
    {
      source: 'wikipedia' as const,
      sourceId: 'Emerald_Bay_State_Park',
      title: 'Emerald Bay State Park',
      url: 'https://en.wikipedia.org/wiki/Emerald_Bay_State_Park',
      license: 'CC BY-SA 4.0',
    },
  ],
}

const proposal = {
  start: { name: 'Tahoe City', lat: 39.1716, lng: -120.1441 },
  end: { name: 'South Lake Tahoe', lat: 38.9399, lng: -119.9772 },
  startId: '3582ed8a-a55e-4fb2-b8af-59dcd9eef16c',
  endId: 'b0f1c2d3-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
  polyline: [
    [39.1716, -120.1441],
    [38.9399, -119.9772],
  ],
  distanceMeters: 42_000,
  durationSeconds: 3_300,
  routeSig: 'sig-abc123',
  estStopCount: 7,
}

describe('previewClip can never become a list', () => {
  test('⚠ THE PIN: an ARRAY of otherwise-valid clips is REJECTED', () => {
    // If this ever goes green, "exactly one" has stopped being a guarantee.
    expect(driveProposal.safeParse({ ...proposal, previewClip: [clip] }).success).toBe(false)
  })

  test('an empty array is rejected too — not "zero is harmless"', () => {
    expect(driveProposal.safeParse({ ...proposal, previewClip: [] }).success).toBe(false)
  })
})

describe('previewClip is nullish so BOTH absences are legal and distinguishable', () => {
  test('null — this server, no clip (a 0-stop route, or a presign that failed)', () => {
    const parsed = driveProposal.parse({ ...proposal, estStopCount: 0, previewClip: null })
    expect(parsed.previewClip).toBeNull()
  })

  test('absent — an OLDER server that predates the field; the key is missing, not null', () => {
    const parsed = driveProposal.parse(proposal)
    expect(parsed.previewClip).toBeUndefined()
    expect('previewClip' in parsed).toBe(false)
  })

  test('a full clip round-trips verbatim, attribution included (CC BY-SA rides along)', () => {
    const parsed = driveProposal.parse({ ...proposal, previewClip: clip })
    expect(parsed.previewClip).toEqual(clip)
  })

  test('durationMs is nullish — a clip with no measured duration is still playable', () => {
    const { durationMs: _omitted, ...noDuration } = clip
    expect(driveProposal.parse({ ...proposal, previewClip: noDuration }).previewClip?.name).toBe(
      'Emerald Bay',
    )
    expect(
      driveProposal.parse({ ...proposal, previewClip: { ...clip, durationMs: null } }).previewClip
        ?.durationMs,
    ).toBeNull()
  })

  test('attribution is optional — a non-wikipedia telling owes no credit line', () => {
    const { attribution: _omitted, ...bare } = clip
    expect(driveProposal.safeParse({ ...proposal, previewClip: bare }).success).toBe(true)
  })
})

describe('the clip carries a name, a URL and a credit — and nothing else', () => {
  test('exactly five keys; no subjectId / poiId / lat / lng / triggerRadiusM / seq / alongSec', () => {
    // Asserted on the SCHEMA, not a parsed value: `z.object` strips unknown keys, so a parse-side
    // assertion would pass even against a shape that had grown a corpus key.
    expect(new Set(Object.keys(drivePreviewClip.shape))).toEqual(
      new Set(['name', 'url', 'contentType', 'durationMs', 'attribution']),
    )
  })

  test('a real contract break still fails — the shape is loose about absence, not about types', () => {
    expect(drivePreviewClip.safeParse({ ...clip, url: 'not-a-url' }).success).toBe(false)
    expect(drivePreviewClip.safeParse({ ...clip, name: 42 }).success).toBe(false)
    expect(drivePreviewClip.safeParse({ ...clip, durationMs: 12.5 }).success).toBe(false)
  })
})

describe('the rollout is additive in BOTH directions', () => {
  test('NEW SERVER, old client: an unknown extra key on the clip is STRIPPED, not rejected', () => {
    // Mobile turns any DTO parse failure into a blocking "please update the app" wall
    // (apps/mobile/src/lib/api.ts `parseDto`), so a strict shape here would brick the preview card on
    // every already-installed build the moment the API adds a field. It tests zod; the claim is ours.
    const withExtra = { ...clip, subjectId: '9d4c6f10-1111-4222-8333-444455556666' }
    const parsed = drivePreviewClip.parse(withExtra)
    expect(parsed).toEqual(clip)
    expect('subjectId' in parsed).toBe(false)
  })

  test('OLD CLIENT, new server: a pre-8a proposal schema ignores previewClip entirely', () => {
    const oldClientProposal = z.object({ routeSig: z.string(), estStopCount: z.number().int().nullish() })
    expect(oldClientProposal.parse({ ...proposal, previewClip: clip })).toEqual({
      routeSig: proposal.routeSig,
      estStopCount: proposal.estStopCount,
    })
  })
})
