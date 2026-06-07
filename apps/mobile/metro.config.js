// Metro config for the bun monorepo. SDK 56 auto-configures most of this; we add
// the workspace root so Metro resolves @skipper/shared from the symlinked layout.
// NOTE (gate): bun's isolated node_modules + Metro is the load-bearing unknown —
// verify on a real EAS/dev build; if it fights, see apps/mobile/README.md.
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
