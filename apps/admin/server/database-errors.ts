/** True for a Postgres unique_violation (SQLSTATE 23505) — how neon-http surfaces a partial-unique-index
 *  conflict. Lets the spend trigger turn a lost idempotency race into a clean 409 instead of a 500. (audit #1) */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code
  if (code === '23505') return true
  return /duplicate key value|unique constraint|\b23505\b/i.test(String((e as { message?: unknown } | null)?.message ?? ''))
}

