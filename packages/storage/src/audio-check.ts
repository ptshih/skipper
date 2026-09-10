import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Decode every byte, then compare measured duration with the metadata the player schedules. */
export async function checkReviewAudio(bytes: Uint8Array, expectedMs: number) {
  const dir = await mkdtemp(join(tmpdir(), 'skipper-review-'))
  const path = join(dir, 'clip.m4a')
  const run = async (args: string[]) => {
    const process = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => process.kill(), 60000)
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
      ])
      return { stdout, stderr, code }
    } finally { clearTimeout(timer) }
  }
  try {
    await writeFile(path, bytes)
    const probe = await run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path])
    const durationMs = Number(JSON.parse(probe.stdout).format?.duration) * 1000
    const decode = await run(['ffmpeg', '-v', 'error', '-xerror', '-i', path, '-map', '0:a:0', '-f', 'null', '-'])
    const ok = bytes.length > 0 && probe.code === 0 && decode.code === 0
      && Number.isFinite(durationMs) && durationMs > 0 && Math.abs(durationMs - expectedMs) <= 1000
    return { ok, advisory: false, durationMs, checkedAt: new Date().toISOString(),
      message: ok ? 'Full decode and duration passed' : 'Audio decode or duration mismatch; cannot waive' }
  } catch {
    return { ok: false, advisory: false, checkedAt: new Date().toISOString(),
      message: 'Audio could not be verified; ffmpeg and ffprobe are required' }
  } finally { await rm(dir, { recursive: true, force: true }) }
}
