import { expect, test } from 'bun:test'
import { updatePromotionalText } from './asc-promotional-text'

function fixture(options: { locale?: string; live?: number; paginated?: boolean; changed?: boolean; mismatch?: boolean; state?: string } = {}) {
  const calls: { method: string; path: string; body?: any }[] = []
  const version = { id: 'live', attributes: { platform: 'IOS', appVersionState: options.state ?? 'READY_FOR_DISTRIBUTION', versionString: '1.1.0' } }
  const loc = { id: 'english', attributes: { locale: options.locale ?? 'en-US', promotionalText: 'Old copy', description: 'Keep this description' } }
  let patched = false
  const asc = async (method: string, path: string, body?: any) => {
    calls.push({ method, path, body })
    if (method === 'PATCH') { patched = true; return {} }
    if (path === '/v1/apps/app/appStoreVersions?limit=200') return {
      data: [
        { id: 'new-draft', attributes: { platform: 'IOS', appVersionState: 'PREPARE_FOR_SUBMISSION', versionString: '2.0' } },
        { id: 'mac-live', attributes: { platform: 'MAC_OS', appVersionState: 'READY_FOR_DISTRIBUTION' } },
        ...Array.from({ length: options.live ?? 1 }, () => version),
      ], links: options.paginated ? { next: 'more' } : {},
    }
    if (path === '/v1/appStoreVersions/live/appStoreVersionLocalizations?limit=200') return { data: [loc] }
    if (path === '/v1/appStoreVersions/live') return { data: version }
    if (path === '/v1/appStoreVersionLocalizations/english') return { data: { ...loc, attributes: {
      ...loc.attributes, promotionalText: patched ? (options.mismatch ? 'Wrong copy' : 'New copy') : options.changed ? 'Other operator copy' : 'Old copy',
    } } }
    throw Error(`Unexpected request: ${method} ${path}`)
  }
  const run = (apply = true, text = 'New copy') => updatePromotionalText({ asc, appId: 'app', text, apply,
    report: (_, live, intended) => live !== intended, log: () => {} })
  return { calls, run }
}

test('targets live iOS despite a newer draft and writes only promotional text', async () => {
  const f = fixture()
  expect(await f.run()).toEqual({ changed: true, applied: true, versionId: 'live' })
  expect(f.calls.filter(c => c.method !== 'GET')).toEqual([{
    method: 'PATCH', path: '/v1/appStoreVersionLocalizations/english',
    body: { data: { type: 'appStoreVersionLocalizations', id: 'english', attributes: { promotionalText: 'New copy' } } },
  }])
  expect(f.calls.at(-1)?.method).toBe('GET')
})

test('preview and matching-copy retries make no writes', async () => {
  const f = fixture()
  expect((await f.run(false)).applied).toBe(false)
  expect((await f.run(true, 'Old copy')).changed).toBe(false)
  expect(f.calls.every(c => c.method === 'GET')).toBe(true)
})

test('legacy READY_FOR_SALE state remains supported', async () => {
  expect((await fixture({ state: 'READY_FOR_SALE' }).run()).applied).toBe(true)
})

for (const options of [{ live: 0 }, { live: 2 }, { paginated: true }, { locale: 'fr-FR' }, { changed: true }]) {
  test(`refuses unsafe target or concurrent edit ${JSON.stringify(options)}`, async () => {
    const f = fixture(options)
    await expect(f.run()).rejects.toThrow()
    expect(f.calls.every(c => c.method === 'GET')).toBe(true)
  })
}

test('rejects invalid copy before API access and detects unsuccessful readback', async () => {
  const f = fixture()
  await expect(f.run(true, 'x'.repeat(171))).rejects.toThrow()
  await expect(f.run(true, ' ')).rejects.toThrow()
  expect(f.calls).toHaveLength(0)
  await expect(fixture({ mismatch: true }).run()).rejects.toThrow('read-back mismatch')
})
