import { expect, test } from 'bun:test'
import { traceFileName, type TraceEnvelope } from '@skipper/engine'
import { newestTraceFirst } from './trace-order'

test('newest recording wins across drive IDs, including existing filenames', () => {
  const file = (driveId: string, recordedAt: string) => ({
    name: traceFileName({ driveId, recordedAt } as TraceEnvelope),
  })
  const old = file('ffffffff-old', '2026-08-04T18:27:11.324Z')
  const recent = file('00000000-new', '2026-08-06T18:15:46.434Z')
  const unknown = { name: 'imported.json' }
  expect([old, unknown, recent].sort(newestTraceFirst)).toEqual([recent, old, unknown])
})
