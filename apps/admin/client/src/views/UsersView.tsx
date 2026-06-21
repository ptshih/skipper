import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Coins, Users } from 'lucide-react'
import { api, type UserRow } from '@/lib/api'
import { errMsg, fmtDate, timeAgo } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Callout } from '@/components/ui/callout'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeletonRows } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// A readable label for a row: the name, or email, or a truncated id for an un-named anonymous account.
const userLabel = (u: UserRow) => u.name?.trim() || u.email?.trim() || `${u.id.slice(0, 8)}…`

export function UsersView() {
  const [granting, setGranting] = useState<UserRow | null>(null)
  const { data: users = [], error: err, isPending } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.users()).users,
  })

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

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead className="text-right" title="Lifetime credits granted (free cap + any grants)">Granted</TableHead>
              <TableHead className="text-right" title="Credits consumed — drives generated">Used</TableHead>
              <TableHead className="text-right" title="Live balance = granted − used">Remaining</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && <TableSkeletonRows rows={6} cols={7} />}
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
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
                </TableCell>
                <TableCell>
                  {u.tier === 'paid' ? (
                    <Badge variant="success">paid</Badge>
                  ) : (
                    <Badge variant="secondary">free</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">{u.granted.toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">{u.used.toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono text-sm font-medium tabular-nums">{u.remaining.toLocaleString()}</TableCell>
                <TableCell className="text-muted-foreground" title={fmtDate(u.createdAt)}>{timeAgo(u.createdAt)}</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setGranting(u)}>
                      <Coins className="h-3.5 w-3.5" /> Grant credits
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!isPending && users.length === 0 && !err && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7}>
                  <EmptyState icon={Users}>No accounts yet.</EmptyState>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

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

  const n = Number(amount)
  const valid = Number.isInteger(n) && n > 0 && n <= 1000

  const grantMut = useMutation({
    mutationFn: () => api.grantCredits(user.id, { amount: n, reason: reason.trim() || undefined }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['users'] }); onClose() },
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !grantMut.isPending) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Coins className="h-4 w-4" /> Grant credits</DialogTitle>
          <DialogDescription>
            Add drive credits to <span className="font-medium text-foreground">{userLabel(user)}</span>. This lifts
            their balance and lifetime cap. It’s free (it grants the user generations, not GCP spend) and can’t be
            undone here.
          </DialogDescription>
        </DialogHeader>

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
              max={1000}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">A positive whole number, 1–1000.</p>
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

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={grantMut.isPending}>Cancel</Button>
          <Button onClick={() => grantMut.mutate()} disabled={!valid || grantMut.isPending}>
            <Coins className="h-4 w-4" />
            {grantMut.isPending ? 'Granting…' : `Grant ${valid ? n : ''} credit${n === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
