import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'

const tabs = [
  { to: '/runs', label: 'Runs' },
  { to: '/tours', label: 'Tours' },
  { to: '/create', label: 'Create' },
]

export function Layout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <div className="font-semibold tracking-tight">⚓ Skipper Admin</div>
          <nav className="flex gap-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm transition-colors',
                    isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
