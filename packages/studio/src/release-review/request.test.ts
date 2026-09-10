import { expect, test } from 'bun:test'
import { requestAudioJudge } from './request'
test('temporary capacity refusal retries with bounded backoff', async () => {
  let calls = 0
  const delays: number[] = []
  const response = await requestAudioJudge('https://example.invalid', {}, (async () => new Response('', { status: ++calls < 3 ? 429 : 200 })),
    async ms => { delays.push(ms) })
  expect(response.status).toBe(200); expect(calls).toBe(3); expect(delays).toEqual([2000, 4000])
})
test('persistent refusal stops; ambiguous failures never silently retry', async () => {
  let calls = 0
  expect((await requestAudioJudge('https://example.invalid', {}, (async () => { calls++; return new Response('', { status: 429 }) }), async () => {})).status).toBe(429)
  expect(calls).toBe(5)
  calls = 0
  await expect(requestAudioJudge('https://example.invalid', {}, (async () => { calls++; throw Error('socket reset') }))).rejects.toThrow('socket reset')
  expect(calls).toBe(1)
})
