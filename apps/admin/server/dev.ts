// Dev-only supervisor for the admin-api. `bun --watch server/index.ts` hot-reloads on file edits,
// but a fatal boot error (a bad import, an unset env var) can exit the whole watcher — leaving the
// vite proxy 502-ing with NO terminal signal (the "dev:server just errors out" failure mode in
// TODO "Admin local-dev resilience"). This wraps the watcher: it respawns on exit with a short
// backoff and a loud log so a crash is visible and self-heals, and forwards Ctrl-C so shutdown
// doesn't orphan the child. Used only by `dev:server`; prod runs `bun server/index.ts` directly.
const RESTART_DELAY_MS = 1000

let child: Bun.Subprocess | null = null
let shuttingDown = false

const shutdown = () => {
  shuttingDown = true
  child?.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

while (!shuttingDown) {
  child = Bun.spawn(['bun', '--watch', 'server/index.ts'], { stdio: ['inherit', 'inherit', 'inherit'] })
  const code = await child.exited
  if (shuttingDown) break
  console.error(
    `\n[admin:dev] server exited (code ${code}) — restarting in ${RESTART_DELAY_MS}ms. ` +
      'Fix the error above; --watch also reloads on save.',
  )
  await Bun.sleep(RESTART_DELAY_MS)
}
