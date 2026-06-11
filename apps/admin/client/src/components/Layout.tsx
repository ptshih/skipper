import { NavLink, Outlet } from 'react-router-dom'
import { Activity, Anchor, BookOpen, Map } from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { to: '/runs', label: 'Runs', icon: Activity },
  { to: '/tours', label: 'Tours', icon: Map },
]

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors',
    isActive
      ? 'bg-zinc-950/5 font-medium text-foreground dark:bg-white/5'
      : 'text-muted-foreground hover:bg-zinc-950/5 hover:text-foreground dark:hover:bg-white/5',
  )

export function Layout() {
  return (
    <div className="min-h-svh bg-zinc-100 text-foreground dark:bg-zinc-950">
      {/* Sidebar — borderless, sits on the page (Catalyst) */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col px-4 py-4 lg:flex">
        <div className="flex items-center gap-2 px-2 py-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
            <Anchor className="h-4 w-4" />
          </span>
          <span className="font-semibold tracking-tight">Skipper Admin</span>
        </div>

        <nav className="mt-3 flex-1 space-y-0.5">
          {nav.map((n) => {
            const Icon = n.icon
            return (
              <NavLink key={n.to} to={n.to} className={navLinkClass}>
                <Icon className="h-4 w-4 shrink-0" />
                {n.label}
              </NavLink>
            )
          })}
        </nav>

        {/* Secondary nav — the cheat sheet */}
        <NavLink to="/reference" className={navLinkClass}>
          <BookOpen className="h-4 w-4 shrink-0" />
          Reference
        </NavLink>

        {/* Account block (Catalyst footer) */}
        <div className="mt-3 flex items-center gap-3 px-2 py-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold">
            F
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-medium">Founder</div>
            <div className="truncate text-xs text-muted-foreground">IAP-gated</div>
          </div>
        </div>
      </aside>

      {/* Main — floating content panel */}
      <div className="lg:pl-64">
        <main className="p-2 lg:p-3">
          <div className="min-h-[calc(100svh-1.5rem)] rounded-xl bg-background p-6 shadow-sm ring-1 ring-zinc-950/5 lg:p-10 dark:ring-white/10">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
