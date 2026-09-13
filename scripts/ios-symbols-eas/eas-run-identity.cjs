// Local, read-only helper. npm exec supplies the pinned EAS installation on PATH.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const VERSION = '24.3.0'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const SHA = /^[a-f0-9]{64}$/
const QUERY = `query NativeSymbolsRunIdentity($id: ID!) {
  workflowRuns { byId(workflowRunId: $id) {
    id name status
    workflow { id fileName app { id } }
    workflowRevision { id blobSha yamlConfig workflow { id fileName app { id } } }
  } }
}`
function ensure(value) {
  if (!value) throw new Error('EAS identity query failed')
}
function findPinnedEas(searchPath) {
  for (const directory of searchPath.split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue
    try {
      const binary = fs.realpathSync(path.join(directory, 'eas'))
      const base = path.dirname(path.dirname(binary))
      const pkg = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'))
      if (
        pkg.name === 'eas-cli' &&
        pkg.version === VERSION &&
        binary === path.join(base, 'bin', 'run')
      )
        return base
    } catch {
      /* An unrelated PATH entry is not the pinned npm package. */
    }
  }
  throw new Error('Pinned EAS CLI unavailable')
}
async function queryRunIdentity(client, id, expectedYamlSha256) {
  ensure(UUID.test(id) && SHA.test(expectedYamlSha256))
  const result = await client
    .query(QUERY, { id }, { requestPolicy: 'network-only', noRetry: true })
    .toPromise()
  ensure(!result.error)
  const run = result.data?.workflowRuns?.byId
  const revision = run?.workflowRevision
  // Only the already expected public YAML may leave the helper; omit arbitrary server text/errors.
  ensure(
    typeof revision?.yamlConfig === 'string' &&
      crypto.createHash('sha256').update(revision.yamlConfig).digest('hex') === expectedYamlSha256,
  )
  ensure(
    run.id === id &&
      /^symbols-[a-f0-9]{64}$/.test(run.name) &&
      ['SUCCESS', 'FAILURE', 'CANCELED', 'IN_PROGRESS', 'NEW'].includes(run.status),
  )
  const identity = (workflow) => {
    ensure(
      UUID.test(workflow?.id) &&
        UUID.test(workflow?.app?.id) &&
        workflow.fileName === 'symbols.yml',
    )
    return { id: workflow.id, fileName: workflow.fileName, app: { id: workflow.app.id } }
  }
  ensure(UUID.test(revision.id) && /^[a-f0-9]{40}$/.test(revision.blobSha))
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    workflow: identity(run.workflow),
    workflowRevision: {
      id: revision.id,
      blobSha: revision.blobSha,
      yamlConfig: revision.yamlConfig,
      workflow: identity(revision.workflow),
    },
  }
}
async function main() {
  const [id, yamlSha] = process.argv.slice(2)
  ensure(process.argv.length === 4 && UUID.test(id) && SHA.test(yamlSha))
  const base = findPinnedEas(process.env.PATH ?? '')
  const SessionManager = require(path.join(base, 'build/user/SessionManager.js')).default
  const { createGraphqlClient } = require(
    path.join(base, 'build/commandUtils/context/contextUtils/createGraphqlClient.js'),
  )
  const session = new SessionManager({ setActor() {} })
  // EAS owns authentication; credentials stay in its in-memory objects, never serialized/extracted.
  const { authenticationInfo } = await session.ensureLoggedInAsync({ nonInteractive: true })
  return queryRunIdentity(createGraphqlClient(authenticationInfo), id, yamlSha)
}
module.exports = { findPinnedEas, queryRunIdentity, QUERY }
if (require.main === module) {
  const stdout = process.stdout.write.bind(process.stdout)
  const stderr = process.stderr.write.bind(process.stderr)
  // Dependency logs/errors may contain authentication or request details. Emit only our result.
  process.stdout.write = () => true
  process.stderr.write = () => true
  main()
    .then((value) => stdout(`${JSON.stringify(value)}\n`))
    .catch(() => {
      stderr('Authenticated EAS identity query failed.\n')
      process.exitCode = 1
    })
}
