// Co-location triage. The bar here is deliberately "flags a small reviewable set", not "is right" —
// the module's own comment explains why no free check can decide this class. What these guard is that
// it stays ADVISORY and doesn't start swallowing legitimately co-located places.
import { describe, expect, it } from 'bun:test'
import { findColocations, colocationReport } from '../src/pipeline/colocation'

const at = (qid: string, name: string, lat: number, lng: number) => ({ qid, name, lat, lng })

describe('findColocations', () => {
  it('flags two DIFFERENT items on a byte-identical point — the UNLV/UNR arboretum shape', () => {
    const groups = findColocations([
      at('Q7865354', 'UNLV Arboretum', 39.5458, -119.817),
      at('Q7895895', 'University of Nevada, Reno Arboretum', 39.5458, -119.817),
      at('Q1', 'Somewhere else', 39.6, -119.9),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.rows.map((r) => r.qid).sort()).toEqual(['Q7865354', 'Q7895895'])
  })

  it('does NOT flag merely adjacent places — exact equality, not a radius', () => {
    // Harold's Club and Harrah's Reno are ~60 m apart and both real. A proximity rule would drown
    // the signal in every dense downtown block.
    expect(findColocations([
      at('Q5659834', "Harold's Club", 39.527522, -119.813472),
      at('Q2841248', "Harrah's Reno", 39.527536, -119.812737),
    ])).toHaveLength(0)
  })

  it('ignores a single item repeated — that is a dedup question, not this one', () => {
    expect(findColocations([
      at('Q1', 'A place', 39.5, -119.8),
      at('Q1', 'A place', 39.5, -119.8),
    ])).toHaveLength(0)
  })

  it('skips rows with no QID (they cannot be told apart) and non-finite coords', () => {
    expect(findColocations([
      { qid: null, name: 'x', lat: 39.5, lng: -119.8 },
      { qid: null, name: 'y', lat: 39.5, lng: -119.8 },
    ])).toHaveLength(0)
    expect(findColocations([
      at('Q1', 'x', Number.NaN, -119.8),
      at('Q2', 'y', Number.NaN, -119.8),
    ])).toHaveLength(0)
  })

  it('orders widest groups first — a 3-way collision is likelier to be wrong than a pair', () => {
    const groups = findColocations([
      at('Q1', 'a', 1, 1), at('Q2', 'b', 1, 1),
      at('Q3', 'c', 2, 2), at('Q4', 'd', 2, 2), at('Q5', 'e', 2, 2),
    ])
    expect(groups[0]!.rows).toHaveLength(3)
    expect(groups[1]!.rows).toHaveLength(2)
  })

  it('reports nothing when there is nothing to review', () => {
    expect(colocationReport([])).toEqual([])
  })

  it('names both places and their QIDs, so the line is actionable without a DB query', () => {
    const lines = colocationReport(findColocations([
      at('Q7865354', 'UNLV Arboretum', 39.5458, -119.817),
      at('Q7895895', 'UNR Arboretum', 39.5458, -119.817),
    ]))
    expect(lines.join('\n')).toContain('Q7865354')
    expect(lines.join('\n')).toContain('UNR Arboretum')
  })
})
