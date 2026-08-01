// toProposeRequest / toCreateRequest AS TESTS — INV-1 on the client: anchor IDS ride the wire on both
// hops, verbatim, and NO coordinate or display name is ever reconstructed into a request. Runs under
// `bun test`.
import { describe, expect, test } from 'bun:test'
import type { DriveProposal, PlannedRoute } from '@skipper/shared'
import { toCreateRequest, toProposeRequest } from './planner-route'

const START = '11111111-1111-4111-8111-111111111111'
const END = '22222222-2222-4222-8222-222222222222'
const MID = '33333333-3333-4333-8333-333333333333'

const planned = (over: Partial<PlannedRoute> = {}): PlannedRoute => ({
  start: START,
  end: END,
  via: undefined,
  targetMinutes: 120,
  ...over,
})

const proposal = (over: Partial<DriveProposal> = {}): DriveProposal => ({
  start: { name: 'Tahoe City, California', lat: 39.1677, lng: -120.1435 },
  end: { name: 'Emerald Bay, California', lat: 38.9541, lng: -120.1097 },
  startId: START,
  endId: END,
  via: undefined,
  viaResolved: undefined,
  polyline: [
    [-120.1435, 39.1677],
    [-120.1097, 38.9541],
  ],
  distanceMeters: 34_000,
  durationSeconds: 2_700,
  routeSig: 'sig',
  estStopCount: 7,
  ...over,
})

describe('toProposeRequest', () => {
  test('emits exactly {start,end} for a one-way — no via, no coords, no names', () => {
    const req = toProposeRequest(planned())
    expect(req).toEqual({ start: START, end: END })
    expect(Object.keys(req).sort()).toEqual(['end', 'start'])
  })

  test('carries via ids through when the planner drew a loop', () => {
    expect(toProposeRequest(planned({ via: [MID] }))).toEqual({
      start: START,
      end: END,
      via: [MID],
    })
  })

  test('an empty via is omitted, not sent as []', () => {
    expect('via' in toProposeRequest(planned({ via: [] }))).toBe(false)
  })

  test('targetMinutes is dropped — /propose has nowhere to put the rider advisory', () => {
    expect('targetMinutes' in toProposeRequest(planned())).toBe(false)
  })

  test('nothing coordinate-shaped can appear in the body', () => {
    const body = JSON.stringify(toProposeRequest(planned({ via: [MID] })))
    expect(body).not.toContain('lat')
    expect(body).not.toContain('lng')
    expect(body).not.toContain('name')
  })
})

describe('toCreateRequest', () => {
  test('reads startId/endId — NOT the resolved display endpoints', () => {
    const req = toCreateRequest(proposal(), 'key-1')
    expect(req).toEqual({ start: START, end: END, idempotencyKey: 'key-1' })
    const body = JSON.stringify(req)
    expect(body).not.toContain('Tahoe City')
    expect(body).not.toContain('lat')
    expect(body).not.toContain('lng')
  })

  test('sends the via IDS, never viaResolved (which is display only)', () => {
    const req = toCreateRequest(
      proposal({
        via: [MID],
        viaResolved: [{ name: 'Sunnyside, California', lat: 39.13, lng: -120.16 }],
      }),
      'key-1',
    )
    expect(req.via).toEqual([MID])
    expect(JSON.stringify(req)).not.toContain('Sunnyside')
  })

  test('an empty via is omitted', () => {
    expect('via' in toCreateRequest(proposal({ via: [] }), 'key-1')).toBe(false)
  })

  test('the key rides verbatim — the same key twice dedupes a retry, a new one is a new create', () => {
    const p = proposal()
    expect(toCreateRequest(p, 'key-1')).toEqual(toCreateRequest(p, 'key-1'))
    expect(toCreateRequest(p, 'key-2').idempotencyKey).toBe('key-2')
  })
})
