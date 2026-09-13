import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureNative, nativeConfiguration, readNativeLocalConfiguration, xcconfigValue } from '../ios-configure'

const native = { SKIPPER_API_URL: 'https://api.skipper.fm', SKIPPER_GOOGLE_MAPS_API_KEY: 'synthetic-maps', SKIPPER_POSTHOG_KEY: 'synthetic-analytics' }
describe('native client build configuration', () => {
  test('explicit native environment overrides native local values, including empty keys', () => {
    const local = { ...native, SKIPPER_GOOGLE_MAPS_API_KEY: 'local-maps' }
    expect(nativeConfiguration(native, local, true).SKIPPER_GOOGLE_MAPS_API_KEY).toBe('synthetic-maps')
    expect(nativeConfiguration({}, local, true).SKIPPER_GOOGLE_MAPS_API_KEY).toBe('local-maps')
    expect(() => nativeConfiguration({ SKIPPER_GOOGLE_MAPS_API_KEY: '' }, local, true)).toThrow('SDK keys')
  })
  test('Release rejects missing SDK keys or absent explicit API URL', () => {
    expect(() => nativeConfiguration({}, {}, true)).toThrow('explicit production API URL')
    expect(() => nativeConfiguration({ SKIPPER_API_URL: native.SKIPPER_API_URL }, {}, true)).toThrow('SDK keys')
    expect(() => nativeConfiguration({ EXPO_PUBLIC_API_URL: native.SKIPPER_API_URL }, {}, true)).toThrow('explicit production API URL')
  })
  test('Release never rewrites a nonproduction URL to a production default', () => {
    for (const url of ['https://staging.invalid', 'https://api.skipper.fm/other', 'https://api.skipper.fm?target=other', 'http://api.skipper.fm']) {
      expect(() => nativeConfiguration({ ...native, SKIPPER_API_URL: url }, {}, true)).toThrow()
    }
  })
  test('xcconfig values preserve HTTPS while rejecting expansion and newlines', () => {
    expect(xcconfigValue('https://api.skipper.fm')).toBe('https:/$()/api.skipper.fm')
    for (const input of ['key\nOVERRIDE=value', '$(SECRET)', 'bad\0value']) expect(() => xcconfigValue(input)).toThrow()
  })
  test('fresh native-only checkout reads selected local JSON and writes private complete output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skipper-config-'))
    try {
      const input = join(root, 'client.json')
      await writeFile(input, JSON.stringify(native), { mode: 0o600 })
      const env = { SKIPPER_IOS_CONFIG_PATH: input }
      await configureNative(root, env, true)
      const output = join(root, '.scratch/ios/Release.xcconfig')
      expect(await readFile(output, 'utf8')).toContain('SKIPPER_GOOGLE_MAPS_API_KEY = synthetic-maps\n')
      expect((await stat(output)).mode & 0o777).toBe(0o600)
      expect(await readNativeLocalConfiguration(root, env)).toEqual(native)
      await configureNative(root, { ...env, SKIPPER_POSTHOG_KEY: 'replacement' }, true)
      expect(await readFile(output, 'utf8')).toContain('SKIPPER_POSTHOG_KEY = replacement\n')
      expect(await readFile(input, 'utf8')).toBe(JSON.stringify(native))
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  test('default native JSON works without a mobile directory; explicit missing files fail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skipper-config-'))
    try {
      expect(await readNativeLocalConfiguration(root, {})).toEqual({})
      await mkdir(join(root, '.scratch/ios'), { recursive: true })
      await writeFile(join(root, '.scratch/ios/client-config.json'), JSON.stringify(native))
      expect(await readNativeLocalConfiguration(root, {})).toEqual(native)
      await expect(readNativeLocalConfiguration(root, { SKIPPER_IOS_CONFIG_PATH: 'missing.json' })).rejects.toThrow('Unable to read')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  test('malformed local files report no contents and never replace last valid output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skipper-config-'))
    try {
      const input = join(root, 'client.json')
      const env = { SKIPPER_IOS_CONFIG_PATH: input }
      await writeFile(input, JSON.stringify(native))
      await configureNative(root, env, true)
      const output = join(root, '.scratch/ios/Release.xcconfig')
      const before = await readFile(output, 'utf8')
      for (const contents of ['secret-marker-not-json', '[]', '{"SKIPPER_POSTHOG_KEY":42}', '{"SERVER_SECRET":"secret-marker"}']) {
        await writeFile(input, contents)
        try { await configureNative(root, env, true); throw new Error('unexpected success') }
        catch (error) {
          expect((error as Error).message).toStartWith('Native local configuration')
          expect((error as Error).message).not.toContain('secret-marker')
        }
        expect(await readFile(output, 'utf8')).toBe(before)
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
