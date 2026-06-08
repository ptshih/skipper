// Metro config for the bun monorepo. SDK 56 auto-configures most of this; we add
// the workspace root so Metro resolves @skipper/shared + @skipper/drive-core from
// the symlinked layout. VERIFIED (2026-06-08): `bunx expo export` bundles cleanly
// through bun's isolated node_modules — a device `expo run:ios` build is the final
// word; if it ever fights, see apps/mobile/README.md.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config
