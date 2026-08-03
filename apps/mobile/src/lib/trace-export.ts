// THE BLACK BOX — the native half: where a recorded trace lands on disk and how it leaves the phone.
// The buffer, the envelope and every rule about them are pure and live in trace-recorder.ts.
//
// ⚠ **Traces are written to disk, not held in memory, and that is the point.** The moment you most
// want a trace is the moment the app crashed or the drive went wrong — an in-memory buffer is gone
// exactly then. Disk also means a trace outlives the session that recorded it, so the founder can
// drive on Saturday and analyse on Monday.
//
// ⚠ **LOCAL-ONLY.** Nothing here uploads. A trace is precise location data about a real person, and
// INV-13 keeps coordinates out of analytics deliberately; the only way one leaves the device is the
// system share sheet, driven by an explicit tap. See @skipper/engine's trace.ts header for what
// changes if this ever stops being dev-gated.
//
// API (expo-file-system 57): `Directory`/`File`/`Paths`; `dir.create({intermediates,idempotent})`;
// `file.write(str)`/`file.textSync()`/`file.delete()` — same idiom as clip-store.ts / offline.ts.
import { Share } from 'react-native'
import { Directory, File, Paths } from 'expo-file-system'
import { parseTraceEnvelope, traceFileName, type TraceEnvelope } from '@skipper/engine'

/** `Paths.document/traces/` — deliberately NOT under `drives/`, which clip-store.ts owns and prunes. */
function tracesDir(): Directory {
  const dir = new Directory(Paths.document, 'traces')
  try {
    dir.create({ intermediates: true, idempotent: true })
  } catch {
    // Already there, or storage is full. A failed create surfaces on the write below, which is the
    // call that can actually tell the caller something useful.
  }
  return dir
}

export interface StoredTrace {
  name: string
  uri: string
  sizeBytes: number
}

/**
 * Persist a recorded trace. Returns the stored file, or null if it could not be written — a full
 * disk must not take the drive down with it, so every caller treats this as best-effort.
 */
export function saveTrace(env: TraceEnvelope): StoredTrace | null {
  try {
    const name = traceFileName(env)
    const file = new File(tracesDir(), name)
    file.write(JSON.stringify(env))
    return { name, uri: file.uri, sizeBytes: file.size ?? 0 }
  } catch {
    return null
  }
}

/** Newest first — the one you just drove is the one you want. */
export function listTraces(): StoredTrace[] {
  try {
    return tracesDir()
      .list()
      .filter((e): e is File => e instanceof File && e.name.endsWith('.json'))
      .map((f) => ({ name: f.name, uri: f.uri, sizeBytes: f.size ?? 0 }))
      .sort((a, b) => b.name.localeCompare(a.name))
  } catch {
    return []
  }
}

/** Read one back — used by an on-device replay, and to validate before sharing. */
export function readTrace(name: string): TraceEnvelope | null {
  try {
    return parseTraceEnvelope(new File(tracesDir(), name).textSync())
  } catch {
    return null
  }
}

export function deleteTrace(name: string): boolean {
  try {
    new File(tracesDir(), name).delete()
    return true
  } catch {
    return false
  }
}

/**
 * Hand the file to the system share sheet — AirDrop to the Mac is the intended route, since that is
 * what puts a trace where the sweep CLI and `bun test` can reach it.
 *
 * ⚠ iOS shares a file by `url`; passing the JSON as `message` instead would truncate a multi-megabyte
 * trace into a text field without saying so.
 */
export async function shareTrace(name: string): Promise<boolean> {
  try {
    const file = new File(tracesDir(), name)
    if (!file.exists) return false
    await Share.share({ url: file.uri, title: name })
    return true
  } catch {
    return false
  }
}
