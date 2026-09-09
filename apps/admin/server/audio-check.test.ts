import { expect, test } from 'bun:test'
import { checkReviewAudio } from './audio-check'

const audioTest = Bun.which('ffmpeg') && Bun.which('ffprobe') ? test : test.skip
audioTest('technical review decodes valid audio and refuses corrupt bytes or scheduling-duration mismatch', async () => {
  // A one-second PCM fixture keeps this test independent of an encoder invocation.
  const pcm = Buffer.alloc(44 + 16000 * 2)
  pcm.write('RIFF', 0); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVEfmt ', 8)
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22)
  pcm.writeUInt32LE(16000, 24); pcm.writeUInt32LE(32000, 28); pcm.writeUInt16LE(2, 32)
  pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(32000, 40)
  for (let i = 0; i < 16000; i++) pcm.writeInt16LE(Math.round(1000 * Math.sin(i * Math.PI / 20)), 44 + i * 2)
  expect((await checkReviewAudio(pcm, 1000)).ok).toBe(true)
  expect((await checkReviewAudio(pcm, 60000)).ok).toBe(false)
  expect((await checkReviewAudio(new TextEncoder().encode('not audio'), 1000)).ok).toBe(false)
})
