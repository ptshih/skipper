import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const output = resolve(root, '.scratch/ios')
await mkdir(output, { recursive: true })
const unitOnly = process.argv.includes('--unit')
const foundationOnly = process.argv.includes('--foundation')
const listing = Bun.spawnSync(['xcrun', 'simctl', 'list', 'devices', 'available', '--json'], { stdout: 'pipe', stderr: 'pipe' })
if (listing.exitCode !== 0) throw new Error('Unable to list available iOS simulators')
const devices = JSON.parse(listing.stdout.toString()) as {
  devices: Record<string, Array<{ udid: string; name: string; isAvailable: boolean }>>
}
const available = Object.entries(devices.devices).filter(([runtime]) => runtime.includes('.iOS-'))
  .flatMap(([, values]) => values).filter(device => device.isAvailable && device.name.startsWith('iPhone'))
const simulator = process.env.SKIPPER_IOS_SIMULATOR_ID ?? available.find(d => d.name === 'iPhone 17 Pro')?.udid ?? available[0]?.udid
if (!simulator) throw new Error('Install an iOS simulator runtime in Xcode before running ios:check')
const destination = `platform=iOS Simulator,id=${simulator}`
const common = ['-project', 'apps/ios/Skipper.xcodeproj', '-scheme', 'Skipper', '-destination', destination,
  '-derivedDataPath', resolve(root, process.env.SKIPPER_IOS_DERIVED_DATA ?? '.scratch/ios/DerivedData'), '-clonedSourcePackagesDirPath', resolve(output, 'SourcePackages'),
  'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-']
const run = async (args: string[]): Promise<void> => {
  const process = Bun.spawn(['xcodebuild', ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' })
  const code = await process.exited
  if (code !== 0) throw new Error(`Native check failed (xcodebuild exit ${code})`)
}
console.log(`Native check: Skipper, ${destination}, fm.skipper.app`)
await run(['build-for-testing', ...common])
const scope = foundationOnly ? ['-only-testing:SkipperTests/NetworkingTests', '-only-testing:SkipperTests/FoundationTests']
  : unitOnly ? ['-only-testing:SkipperTests'] : []
const result = resolve(output, `Test-${Date.now()}.xcresult`)
await run(['test-without-building', ...common, ...scope, '-parallel-testing-enabled', 'NO', '-resultBundlePath', result])
console.log(`Native verification passed. Results: ${result}`)
