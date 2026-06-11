import { useState, useEffect, useRef, useCallback } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Activity, Anchor, BookOpen, Map, MapPin, Moon, Search, Sun } from 'lucide-react'

const NAV = [
  { to: '/runs', label: 'Runs', icon: Activity },
  { to: '/tours', label: 'Tours', icon: Map },
  { to: '/pois', label: 'POIs', icon: MapPin },
]

export function Layout() {
  const [theme, setTheme] = useState(() => localStorage.getItem('sk_theme') || 'light')
  const [palette, setPalette] = useState(false)
  const location = useLocation()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
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

  const crumb = getCrumb(location.pathname)

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark"><Anchor size={16} /></span>
          <span className="brand__name">Skipper</span>
          <span className="brand__env">admin</span>
        </div>

        <nav className="nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => `nav__item${isActive ? ' is-active' : ''}`}
            >
              <n.icon size={17} />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__spacer" />

        <nav className="nav" style={{ marginTop: 0 }}>
          <NavLink
            to="/reference"
            className={({ isActive }) => `nav__item${isActive ? ' is-active' : ''}`}
          >
            <BookOpen size={17} />
            Reference
          </NavLink>
        </nav>

        <div className="account">
          <span className="account__avatar">F</span>
          <div style={{ minWidth: 0 }}>
            <div className="account__name">Founder</div>
            <div className="account__sub">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} />
              IAP-gated
            </div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumb">
            <span>Skipper Admin</span>
            {crumb.map(([label], i) => (
              <span key={i}>
                <span className="crumb__sep">/</span>
                <b>{label}</b>
              </span>
            ))}
          </div>
          <span className="topbar__spacer" />
          <button className="searchbtn" onClick={() => setPalette(true)}>
            <Search size={15} />
            <span>Search or jump to…</span>
            <span className="kbd">⌘K</span>
          </button>
          <div className="live is-on" title="Auto-refresh on">
            <span className="live__dot" />
            <span>live</span>
          </div>
          <button
            className="iconbtn"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>

        <div className="content">
          <div className="content__inner">
            <Outlet />
          </div>
        </div>
      </div>

      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  )
}

function getCrumb(path: string): [string, string][] {
  if (path.startsWith('/tours/') && path.length > 7) return [['Tours', '/tours'], ['Detail', '']]
  if (path === '/tours') return [['Tours', '']]
  if (path === '/runs') return [['Runs', '']]
  if (path === '/create') return [['Tours', '/tours'], ['Create', '']]
  if (path === '/reference') return [['Reference', '']]
  if (path === '/pois') return [['POIs', '']]
  return []
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

  const all = [
    { group: 'Go to', label: 'Runs', icon: Activity, href: '/runs' },
    { group: 'Go to', label: 'Tours', icon: Map, href: '/tours' },
    { group: 'Go to', label: 'POIs', icon: MapPin, href: '/pois' },
    { group: 'Go to', label: 'Reference', icon: BookOpen, href: '/reference' },
    { group: 'Actions', label: 'Create a tour', icon: Map, href: '/create' },
  ]
  const items = q ? all.filter((it) => it.label.toLowerCase().includes(q.toLowerCase())) : all

  useEffect(() => setActive(0), [q])

  const run = (href: string) => { navigate(href); onClose() }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) run(items[active].href) }
  }

  let lastGroup = ''
  return (
    <>
      <div className="scrim" style={{ background: 'rgba(18,18,20,0.3)', zIndex: 60 }} onClick={onClose} />
      <div className="palette">
        <div className="palette__input">
          <Search size={18} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search or jump to…"
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette__list">
          {items.length === 0 && <div className="empty" style={{ padding: 28 }}>No matches.</div>}
          {items.map((it, i) => {
            const showGroup = it.group !== lastGroup ? ((lastGroup = it.group), true) : false
            return (
              <div key={i}>
                {showGroup && <div className="palette__group">{it.group}</div>}
                <div
                  className={`palette__item${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(it.href)}
                >
                  <it.icon size={16} />
                  <span>{it.label}</span>
                  <span className="pi-sub">{it.group}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
