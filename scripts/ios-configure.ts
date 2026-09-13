// Native client SDK configuration only. Never use a server Routes key in the iOS bundle.
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export const NATIVE_CONFIG_KEYS = [
  'SKIPPER_API_URL', 'SKIPPER_GOOGLE_MAPS_API_KEY', 'SKIPPER_POSTHOG_KEY', 'SKIPPER_POSTHOG_HOST',
] as const
export type NativeConfiguration = Record<typeof NATIVE_CONFIG_KEYS[number], string>
type Environment = Record<string, string | undefined>

export function xcconfigValue(value: string): string {
  if (/[\r\n\0]/.test(value) || value.includes('$(')) {
    throw new Error('Invalid native build configuration value')
  }
  // xcconfig treats // as a comment even inside quotes.
  return value.replaceAll('//', '/$()/')
}

function httpsURL(raw: string, label: string): URL {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error(`Invalid native ${label} URL`) }
  if (url.protocol !== 'https:') throw new Error(`Native ${label} configuration requires HTTPS`)
  return url
}

export function nativeConfiguration(environment: Environment, local: Environment, release: boolean): NativeConfiguration {
  // Empty explicit values stay explicit: an empty deployment key must fail, not revive a local key.
  const read = (key: typeof NATIVE_CONFIG_KEYS[number]): string | undefined => environment[key] ?? local[key]
  const rawURL = read('SKIPPER_API_URL')
  if (release && !rawURL) throw new Error('Release requires an explicit production API URL')
  const apiURL = rawURL ?? 'https://api.skipper.fm'
  const url = httpsURL(apiURL, 'API')
  if (release && (url.origin !== 'https://api.skipper.fm' || !['', '/'].includes(url.pathname) || url.search || url.hash || url.username || url.password)) {
    throw new Error('Release requires the production Skipper API origin')
  }
  const values = {
    SKIPPER_API_URL: apiURL,
    SKIPPER_GOOGLE_MAPS_API_KEY: read('SKIPPER_GOOGLE_MAPS_API_KEY') ?? '',
    SKIPPER_POSTHOG_KEY: read('SKIPPER_POSTHOG_KEY') ?? '',
    SKIPPER_POSTHOG_HOST: read('SKIPPER_POSTHOG_HOST') ?? 'https://us.i.posthog.com',
  }
  if (release && (!values.SKIPPER_GOOGLE_MAPS_API_KEY || !values.SKIPPER_POSTHOG_KEY)) {
    throw new Error('Release requires the public iOS Maps and PostHog SDK keys')
  }
  httpsURL(values.SKIPPER_POSTHOG_HOST, 'PostHog')
  for (const value of Object.values(values)) xcconfigValue(value)
  return values
}

export async function readNativeLocalConfiguration(root: string, environment: Environment): Promise<Environment> {
  const explicitPath = environment.SKIPPER_IOS_CONFIG_PATH
  const path = resolve(root, explicitPath ?? '.scratch/ios/client-config.json')
  let raw: string
  try { raw = await readFile(path, 'utf8') } catch (error) {
    if (!explicitPath && (error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error('Unable to read native local configuration')
  }
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('Native local configuration must be valid JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.entries(value).some(([key, entry]) => !NATIVE_CONFIG_KEYS.some(allowed => allowed === key) || typeof entry !== 'string')) {
    throw new Error('Native local configuration must contain only string SKIPPER_* client settings')
  }
  return value as Environment
}

export async function configureNative(root: string, environment: Environment, release: boolean): Promise<void> {
  const values = nativeConfiguration(environment, await readNativeLocalConfiguration(root, environment), release)
  const directory = resolve(root, '.scratch/ios')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = resolve(directory, `${release ? 'Release' : 'Debug'}.xcconfig`)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, '// Generated local client configuration. Do not commit.\n' +
      Object.entries(values).map(([key, value]) => `${key} = ${xcconfigValue(value)}`).join('\n') + '\n',
      { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(() => {}) }
}

if (import.meta.main) {
  const release = process.argv.includes('--release')
  await configureNative(resolve(import.meta.dir, '..'), process.env, release)
  console.log(`Native ${release ? 'Release' : 'Debug'} configuration written (SDK values redacted).`)
}
