import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Coins, Users } from 'lucide-react'
import { api, type UserRow } from '@/lib/api'
import { errMsg, fmtDate, timeAgo } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { useAdminList } from '@/lib/useAdminList'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Callout } from '@/components/ui/callout'
import { EmptyState } from '@/components/ui/empty-state'
import { FormDialog } from '@/components/ui/form-dialog'

// A readable label for a row: the name, or email, or a truncated id for an un-named anonymous account.
const userLabel = (u: UserRow) => u.name?.trim() || u.email?.trim() || `${u.id.slice(0, 8)}…`

// ⚠ MUST MATCH `MAX_ADMIN_GRANT` in apps/admin/server/index.ts, which is the authority — the server
// 400s above it regardless of what this allows. It cannot be imported: the client tsconfig includes
// only `src`, and the root one excludes `client`. `server/grant-ceiling.test.ts` pins the two
// literals together so they cannot drift silently.
const MAX_GRANT = 1000

export function UsersView() {
  const [granting, setGranting] = useState<UserRow | null>(null)
  const { data: users, error: err, isPending } = useAdminList(qk.users(), async () => (await api.users()).users)

  const columns: Column<UserRow>[] = [
    {
      header: 'User',
      cell: (u) => (
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium">{userLabel(u)}</div>
            {u.name?.trim() && u.email?.trim() && (
              <div className="truncate text-xs text-muted-foreground">{u.email}</div>
            )}
          </div>
          {u.role === 'admin' && <Badge variant="outline">admin</Badge>}
          {u.isAnonymous && <Badge variant="secondary">anon</Badge>}
          {u.banned && <Badge variant="destructive">banned</Badge>}
        </div>
      ),
    },
    {
      header: <span title="Lifetime credits granted (free cap + any grants)">Granted</span>,
      headClassName: 'text-right',
      cellClassName: 'text-right font-mono text-sm tabular-nums',
      cell: (u) => u.granted.toLocaleString(),
    },
    {
      header: <span title="Credits consumed — drives generated">Used</span>,
      headClassName: 'text-right',
      cellClassName: 'text-right font-mono text-sm tabular-nums',
      cell: (u) => u.used.toLocaleString(),
    },
    {
      header: <span title="Live balance = granted − used">Remaining</span>,
      headClassName: 'text-right',
      cellClassName: 'text-right font-mono text-sm font-medium tabular-nums',
      cell: (u) => u.remaining.toLocaleString(),
    },
    {
      header: 'Joined',
      cellClassName: 'text-muted-foreground',
      cell: (u) => <span title={fmtDate(u.createdAt)}>{timeAgo(u.createdAt)}</span>,
    },
    {
      header: '',
      headClassName: 'w-36',
      // ⚠ Not offered on an anonymous row, and the server refuses it too (409 anonymous_account).
      // An anonymous session is a real `user` row, so this used to look perfectly grantable — but
      // /drives is behind requireAccount so the credit can never be spent, and the plugin hard-deletes
      // that row at signup, taking the grant with it (INV-4). A comp that silently evaporates is the
      // worst outcome; refuse it where the operator can see why.
      cell: (u) => (
        <div className="flex justify-end">
          {u.isAnonymous ? (
            <span
              className="text-xs text-muted-foreground"
              title="Anonymous pre-signup session — credits here can't be spent and are deleted when they sign up."
            >
              no account yet
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setGranting(u)}>
              <Coins className="h-3.5 w-3.5" /> Grant credits
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Accounts and their drive-credit ledger. Granted = lifetime credits given (the free cap plus any grants); Used = drives generated; Remaining = live balance. Grant more credits from the row action."
      />

      {err && (
        <Callout variant="error">
          <span className="font-medium">Error loading users:</span> {errMsg(err)}
        </Callout>
      )}

      <DataTable
        columns={columns}
        rows={users}
        rowKey={(u) => u.id}
        loading={isPending}
        empty={!err ? <EmptyState icon={Users}>No accounts yet.</EmptyState> : undefined}
      />

      {granting && <GrantCreditsDialog user={granting} onClose={() => setGranting(null)} />}
    </div>
  )
}

/* ── GRANT CREDITS ── */

// Appends a positive admin_grant to the user's credit ledger (lifts both balance and lifetime cap).
// NOT a GCP spend — it hands the USER free drive generations — so no founder-go gate; the grant is
// append-only (no reverse UI), so the explicit "Grant" button is the deliberate confirm.
function GrantCreditsDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('10')
  const [reason, setReason] = useState('')
  // ONE key per dialog, reused across retries — a double-click or a retried POST then writes exactly
  // one ledger row (the server keys the entry on this and ON CONFLICT DO NOTHING). Same shape as the
  // per-card key POST /drives uses. useState initialiser so it survives re-renders but not a reopen.
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const n = Number(amount)
  const valid = Number.isInteger(n) && n > 0 && n <= MAX_GRANT

  const grantMut = useMutation({
    mutationFn: () =>
      api.grantCredits(user.id, { amount: n, reason: reason.trim() || undefined, idempotencyKey }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.users() }); onClose() },
  })

  return (
    <FormDialog
      open
      onOpenChange={(o) => { if (!o && !grantMut.isPending) onClose() }}
      icon={Coins}
      title="Grant credits"
      description={
        <>
          Add drive credits to <span className="font-medium text-foreground">{userLabel(user)}</span>. This lifts
          their balance and lifetime cap. It’s free (it grants the user generations, not GCP spend) and can’t be
          undone here.
        </>
      }
      contentClassName="sm:max-w-md"
      onSubmit={() => grantMut.mutate()}
      submitIcon={Coins}
      submitLabel={`Grant ${valid ? n : ''} credit${n === 1 ? '' : 's'}`}
      submitPendingLabel="Granting…"
      submitDisabled={!valid}
      pending={grantMut.isPending}
    >
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Current balance</span>
            <span className="font-mono font-medium tabular-nums">{user.remaining.toLocaleString()}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>granted {user.granted.toLocaleString()} · used {user.used.toLocaleString()}</span>
            {valid && <span>→ {(user.remaining + n).toLocaleString()} after</span>}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="grant-amount">Amount *</Label>
          <Input
            id="grant-amount"
            type="number"
            min={1}
            max={MAX_GRANT}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">A positive whole number, 1–{MAX_GRANT}.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="grant-reason">Reason</Label>
          <Textarea
            id="grant-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. make-good for a failed generation"
            rows={2}
          />
          <p className="text-xs text-muted-foreground">Optional audit note (recorded on the ledger entry alongside your email).</p>
        </div>
      </div>

      {grantMut.error && (
        <Callout variant="error" className="rounded-lg px-3 py-2">{errMsg(grantMut.error)}</Callout>
      )}
    </FormDialog>
  )
}
