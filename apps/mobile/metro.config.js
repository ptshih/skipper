// Metro config for the bun monorepo. SDK 56 auto-configures most of this; we add
// the workspace pieces the app actually consumes so Metro resolves @skipper/shared
// + @skipper/drive-core from the symlinked layout. VERIFIED (2026-06-08): `bunx
// expo export` bundles cleanly through bun's isolated node_modules — a device
// `expo run:ios` build is the final word; if it ever fights, see apps/mobile/README.md.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// Watch ONLY what the app's module graph touches — NOT the whole monorepo.
// The app imports exactly two workspace packages (@skipper/shared,
// @skipper/drive-core); its npm deps are symlinks whose realpath lives under
// `<root>/node_modules/.bun`, so that store must be watched too. Watching the
// whole `workspaceRoot` (the old config) made Metro re-crawl / reload on edits to
// packages/studio, packages/db, packages/sim, docs/, .scratch-audio, apps/api,
// and every `.git` operation — none of which are in the app's graph. Keep this an
// allowlist (add a package's dir here if the app starts importing it); a denylist
// of noisy dirs would silently rot as new ones appear. (Added 2026-06-09.)
config.watchFolders = [
  path.resolve(workspaceRoot, 'node_modules'), // the .bun store the app's deps symlink into
  path.resolve(workspaceRoot, 'packages/shared'),
  path.resolve(workspaceRoot, 'packages/drive-core'),
]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config
