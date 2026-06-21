import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, Anchor, BookOpen, Compass, Gauge, Layers, MapPin, Menu, Moon, Search, Sun } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { HealthBanner } from '@/components/HealthBanner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type AppPath = '/jobs' | '/evals' | '/regions' | '/pois' | '/reference'

const NAV: { to: AppPath; label: string; icon: React.ElementType }[] = [
  { to: '/jobs', label: 'Jobs', icon: Activity },
  { to: '/evals', label: 'Evals', icon: Gauge },
  { to: '/regions', label: 'Regions', icon: Layers },
  { to: '/pois', label: 'POIs', icon: MapPin },
]

const itemBase =
  'relative flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm font-medium transition-colors'
const itemInactive = 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'

function NavItem({ to, label, icon: Icon, onClick }: { to: AppPath; label: string; icon: React.ElementType; onClick?: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={itemBase}
      activeProps={{ className: 'text-foreground' }}
      inactiveProps={{ className: itemInactive }}
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute -left-3 inset-y-1 w-0.5 rounded-r bg-foreground" />}
          <Icon size={18} className={cn('shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')} />
          {label}
        </>
      )}
    </Link>
  )
}

function BrandMark() {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
      <Anchor size={16} />
    </span>
  )
}

// The sidebar's inner content — shared by the fixed desktop rail and the mobile slide-over.
function SidebarBody({
  theme,
  onToggleTheme,
  onSearch,
  onNavigate,
}: {
  theme: string
  onToggleTheme: () => void
  onSearch: () => void
  onNavigate?: () => void
}) {
  return (
    <>
      <div className="border-b border-border px-3 py-3.5">
        <div className="flex items-center gap-3 px-2">
          <BrandMark />
          <span className="text-sm font-semibold text-foreground">Skipper</span>
          <span className="ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">admin</span>
        </div>
      </div>

      <div className="px-3 py-3">
        <button onClick={() => { onNavigate?.(); onSearch() }} className={cn(itemBase, itemInactive)}>
          <Search size={18} className="shrink-0 text-muted-foreground" />
          Search
          <kbd className="ml-auto rounded border bg-background px-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">⌘K</kbd>
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 border-t border-border px-3 py-3">
        {NAV.map((n) => (
          <NavItem key={n.to} to={n.to} label={n.label} icon={n.icon} onClick={onNavigate} />
        ))}
      </nav>

      <div className="flex-1" />

      <nav className="flex flex-col gap-0.5 px-3 py-3">
        <NavItem to="/reference" label="Reference" icon={BookOpen} onClick={onNavigate} />
      </nav>

      <div className="border-t border-border px-3 py-3.5">
        <div className="flex items-center gap-3 px-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">F</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-tight text-foreground">Founder</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
              IAP-gated
            </div>
          </div>
          <button
            onClick={onToggleTheme}
            title="Toggle theme"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
    </>
  )
}

export function Layout() {
  const [theme, setTheme] = useState(() => localStorage.getItem('sk_theme') || 'light')
  const [palette, setPalette] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('sk_theme', theme)
  }, [theme])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <div className="relative isolate flex min-h-svh w-full flex-col bg-zinc-100 lg:flex-row dark:bg-zinc-950">
      {/* Sidebar (desktop) — sits on the page; main content floats as a panel beside it. */}
      <aside className="fixed inset-y-0 left-0 z-10 flex w-64 flex-col max-lg:hidden">
        <SidebarBody theme={theme} onToggleTheme={toggleTheme} onSearch={() => setPalette(true)} />
      </aside>

      {/* Top bar (mobile) — hamburger opens the sidebar as a slide-over. */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-zinc-100/90 px-4 backdrop-blur lg:hidden dark:bg-zinc-950/90">
        <button
          onClick={() => setMobileNav(true)}
          aria-label="Open navigation"
          className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <Menu size={18} />
        </button>
        <BrandMark />
        <span className="text-sm font-semibold text-foreground">Skipper</span>
        <span className="flex-1" />
        <button
          onClick={toggleTheme}
          title="Toggle theme"
          className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      {/* Mobile slide-over nav */}
      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody
            theme={theme}
            onToggleTheme={toggleTheme}
            onSearch={() => setPalette(true)}
            onNavigate={() => setMobileNav(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Main — the floating content panel (rounded, ringed, on the gray page). */}
      <main className="flex flex-1 flex-col pb-2 max-lg:pt-2 lg:min-w-0 lg:py-2 lg:pr-2 lg:pl-64">
        <div className="grow px-4 py-6 max-lg:mx-2 max-lg:rounded-xl max-lg:border max-lg:bg-card lg:ml-2 lg:rounded-xl lg:bg-card lg:p-10 lg:shadow-sm lg:ring-1 lg:ring-border dark:lg:ring-white/10">
          <div className="mx-auto max-w-[1200px]">
            <HealthBanner />
            <Outlet />
          </div>
        </div>
      </main>

      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  )
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => { inputRef.current?.focus() }, [])

  const onEsc = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() },
    [onClose],
  )
  useEffect(() => {
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onEsc])

  // POIs warm the shared ['pois'] cache (same key/shape as PoisView) — free when that page loaded it.
  const { data: pois = [] } = useQuery({ queryKey: ['pois'], queryFn: async () => (await api.pois()).pois })

  type PaletteItem = { group: string; label: string; icon: React.ElementType; hint?: string; onSelect: () => void }
  const go = (to: AppPath) => () => { navigate({ to }); onClose() }
  const openPoi = (id: string) => () => { navigate({ to: '/pois', search: { poi: id } }); onClose() }

  const navItems: PaletteItem[] = [
    { group: 'Go to', label: 'Jobs', icon: Activity, onSelect: go('/jobs') },
    { group: 'Go to', label: 'Evals', icon: Gauge, onSelect: go('/evals') },
    { group: 'Go to', label: 'Regions', icon: Layers, onSelect: go('/regions') },
    { group: 'Go to', label: 'POIs', icon: MapPin, onSelect: go('/pois') },
    { group: 'Go to', label: 'Reference', icon: BookOpen, onSelect: go('/reference') },
  ]
  const actionItems: PaletteItem[] = [
    { group: 'Actions', label: 'Discover POIs', icon: Compass, onSelect: go('/regions') },
  ]
  const ql = q.toLowerCase()
  const navMatches = q ? navItems.filter((it) => it.label.toLowerCase().includes(ql)) : navItems
  const actionMatches = q ? actionItems.filter((it) => it.label.toLowerCase().includes(ql)) : actionItems
  // POIs only when typing (don't dump the whole corpus on open); capped at 8.
  const poiMatches: PaletteItem[] = q
    ? pois
        .filter((p) => p.name.toLowerCase().includes(ql) || p.sourceId.toLowerCase().includes(ql))
        .slice(0, 8)
        .map((p) => ({ group: 'POIs', label: p.name, icon: MapPin, hint: p.sourceId, onSelect: openPoi(p.id) }))
    : []
  const items = [...navMatches, ...actionMatches, ...poiMatches]

  useEffect(() => setActive(0), [q])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.onSelect() }
  }

  let lastGroup = ''
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-[84px] z-[61] w-[600px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-lg">
        <div className="flex items-center gap-3 border-b px-4 py-3.5 text-muted-foreground">
          <Search size={18} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search POIs, actions, or jump to…"
            className="w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-background px-1.5 font-mono text-[10px] leading-relaxed">esc</kbd>
        </div>
        <div className="max-h-[360px] overflow-y-auto p-2">
          {items.length === 0 && <div className="px-3 py-7 text-center text-sm text-muted-foreground">No matches.</div>}
          {items.map((it, i) => {
            const showGroup = it.group !== lastGroup ? ((lastGroup = it.group), true) : false
            return (
              <div key={i}>
                {showGroup && (
                  <div className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {it.group}
                  </div>
                )}
                <div
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm',
                    i === active && 'bg-accent',
                  )}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => it.onSelect()}
                >
                  <it.icon size={16} className="text-muted-foreground" />
                  <span>{it.label}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{it.hint ?? it.group}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
