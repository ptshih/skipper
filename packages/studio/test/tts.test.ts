import { describe, expect, test } from 'bun:test'
import { buildSynthesisRequest } from '../src/pipeline/tts'
import { SKIPPER_TTS_STYLE_PROMPT, TTS_AUDIO_ENCODING, TTS_LANGUAGE_CODE, TTS_MODEL } from '../src/models'

describe('buildSynthesisRequest (Cloud TTS text:synthesize body)', () => {
  const body = buildSynthesisRequest('Welcome aboard, folks.', 'Sulafat')

  test('uses camelCase field names (snake_case 400s on the REST API)', () => {
    expect(body.voice.modelName).toBe(TTS_MODEL)
    expect(body.voice).not.toHaveProperty('model_name')
    expect(body.audioConfig.audioEncoding).toBe(TTS_AUDIO_ENCODING)
    expect(body.audioConfig).not.toHaveProperty('audio_encoding')
  })

  test('script goes in input.text, delivery style in input.prompt', () => {
    expect(body.input.text).toBe('Welcome aboard, folks.')
    expect(body.input.prompt).toBe(SKIPPER_TTS_STYLE_PROMPT)
  })

  test('carries the requested voice + language', () => {
    expect(body.voice.name).toBe('Sulafat')
    expect(body.voice.languageCode).toBe(TTS_LANGUAGE_CODE)
  })
})
