// Harvested verbatim out of the deleted app/create.tsx, comment intact. It lives in src/lib now
// because a conversation can hold SEVERAL preview cards and each one mints its own key.

// A v4 UUID for the create idempotency key (sent as createDrive.idempotencyKey, stable across retries
// of one logical create). Uses the platform crypto when present, else a Math.random v4 — this key
// needs UNIQUENESS to dedupe a retry, not unguessability, and Hermes ships no guaranteed crypto global.
export function uuidV4(): string {
  const cr = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cr?.randomUUID) return cr.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
