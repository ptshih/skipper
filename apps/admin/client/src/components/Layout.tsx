import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Activity, Anchor, Map, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { to: '/runs', label: 'Runs', icon: Activity },
  { to: '/tours', label: 'Tours', icon: Map },
  { to: '/create', label: 'Create', icon: Plus },
]

export function Layout() {
  const { pathname } = useLocation()
  const current = nav.find((n) => pathname.startsWith(n.to))?.label ?? 'Admin'

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-muted/40 md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Anchor className="h-5 w-5" />
          <span className="font-semibold tracking-tight">Skipper Admin</span>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {nav.map((n) => {
            const Icon = n.icon
            return (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </NavLink>
            )
          })}
        </nav>
        <div className="border-t px-4 py-3 text-xs text-muted-foreground">Founder-only · IAP</div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/95 px-6 text-sm backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <Anchor className="h-4 w-4 md:hidden" />
          <span className="text-muted-foreground">Admin</span>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{current}</span>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
