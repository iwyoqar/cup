import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { deriveHealth, overallState, PulseContext, pulseAttention, useSystemPulse } from '../lib/health';
import { AdminPage, findNav, groupOf, NavGroup, NAV_GROUPS, NavItem } from '../lib/nav';
import { AdminProfile } from '../lib/types';
import { Icon } from './icons';

interface AdminShellProps {
  page: AdminPage;
  onNavigate: (page: AdminPage) => void;
  onLogout: () => void;
  admin: AdminProfile;
  children: ReactNode;
}

const STORAGE_KEY = 'cup-admin-sidebar-sections';

function loadExpanded(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set(); // blocked/unavailable storage — falls back to in-memory state (still works for the session)
  }
}

function saveExpanded(ids: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore — persistence is a convenience, not a functional requirement.
  }
}

function NavLink({ it, active, attention, onClick }: { it: NavItem; active: boolean; attention: boolean; onClick: () => void }) {
  return (
    <button aria-current={active ? 'page' : undefined} className={`nav-item${active ? ' nav-item--active' : ''}`} onClick={onClick} title={it.label} type="button">
      <Icon name={it.icon} />
      <span className="nav-item__label">{it.label}</span>
      {attention && <span aria-label="Needs attention" className="nav-item__attention" />}
    </button>
  );
}

// One collapsible section: a real <button> header (Part 3's accessibility requirement — aria-expanded/aria-
// controls, keyboard-reachable, Enter/Space toggles it natively since it's a <button>) plus its children, hidden
// via CSS (not unmounted) when collapsed so the icon-rail breakpoint can force them visible regardless of state.
function NavSection({ g, active, open, attention, onToggle, onNavigate }: { g: NavGroup; active: AdminPage; open: boolean; attention: Partial<Record<AdminPage, boolean>>; onToggle: () => void; onNavigate: (id: AdminPage) => void }) {
  const panelId = useId();
  const hasActive = g.items.some((i) => i.id === active);
  return (
    <div className="nav-group">
      <button aria-controls={panelId} aria-expanded={open} className={`nav-section${hasActive ? ' nav-section--active' : ''}`} onClick={onToggle} type="button">
        <span className="nav-group__label">{g.label}</span>
        <span className={`nav-section__chevron${open ? ' nav-section__chevron--open' : ''}`}>
          <Icon name="chevron" />
        </span>
      </button>
      <div className={`nav-section__panel${open ? ' nav-section__panel--open' : ''}`} id={panelId}>
        {g.items.map((it) => (
          <NavLink attention={!!attention[it.id]} active={it.id === active} it={it} key={it.id} onClick={() => onNavigate(it.id)} />
        ))}
      </div>
    </div>
  );
}

// The Admin frame: a black sidebar (the Mini App's structural black) with an accordion of grouped navigation, a
// quiet top bar with breadcrumb + account, and a centred content column. Below 1100 px the sidebar collapses to an
// icon rail (labels hidden — every item stays visible there regardless of accordion state, since there is no
// group-label text to click); below 760 px it becomes a drawer opened from the top bar.
export function AdminShell({ page, onNavigate, onLogout, admin, children }: AdminShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pulse = useSystemPulse();
  const attention = pulseAttention(pulse);
  const health = deriveHealth(pulse);
  const overall = overallState(health);
  const { item, group } = findNav(page);

  // Part 4: only the section containing the initial route auto-opens. Part 6: everything after that is persisted.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const persisted = loadExpanded();
    const active = groupOf(page);
    if (active) persisted.add(active.id);
    return persisted;
  });

  useEffect(() => saveExpanded(expanded), [expanded]);

  // Part 4/5: a route change always ensures its own section is open, but NEVER closes a section the user opened
  // manually — this only ever adds to the set.
  useEffect(() => {
    const active = groupOf(page);
    if (!active) return;
    setExpanded((prev) => (prev.has(active.id) ? prev : new Set(prev).add(active.id)));
  }, [page]);

  const toggleSection = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    document.title = `${item.label} · CUP Admin`;
  }, [item.label]);

  // Opening a page is a natural moment to refresh the status the sidebar shows (it otherwise re-reads once a minute).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    pulse.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const go = (id: AdminPage) => {
    onNavigate(id);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };

  const statusTitle = pulse.loading ? 'Checking…' : overall === 'healthy' ? 'All systems healthy' : overall === 'unknown' ? 'Status unknown' : 'Needs attention';
  const statusSub = pulse.sync
    ? `Sync ${pulse.sync.config.syncEnabled ? 'ON' : 'OFF'} · queue ${pulse.sync.queue.queued + pulse.sync.queue.processing}`
    : pulse.loading
      ? 'Reading status'
      : 'Sync status unavailable';

  return (
    <PulseContext.Provider value={pulse}>
    <div className={`shell${navOpen ? ' shell--nav-open' : ''}`}>
      <aside aria-label="Primary" className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__mark">CUP</span>
          <span className="sidebar__tag">Admin</span>
        </div>
        <nav className="sidebar__nav">
          {NAV_GROUPS.map((g) =>
            g.label === null ? (
              // The one non-collapsible group (Dashboard) — no header, always rendered, exactly as before the accordion.
              <div className="nav-group" key={g.id}>
                {g.items.map((it) => (
                  <NavLink attention={!!attention[it.id]} active={it.id === page} it={it} key={it.id} onClick={() => go(it.id)} />
                ))}
              </div>
            ) : (
              <NavSection active={page} attention={attention} g={g} key={g.id} onNavigate={go} onToggle={() => toggleSection(g.id)} open={expanded.has(g.id)} />
            ),
          )}
        </nav>
        <button className="sidebar__status" onClick={() => go('system-health')} title="Open System Health" type="button">
          <span className={`dot dot--${pulse.loading ? 'unknown' : overall}`} />
          <span className="sidebar__status-text">
            <span className="sidebar__status-title">{statusTitle}</span>
            <span className="sidebar__status-sub">{statusSub}</span>
          </span>
        </button>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />

      <div className="shell__main">
        <div className="topbar">
          <button aria-label="Open navigation" className="topbar__menu" onClick={() => setNavOpen(true)} type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <div className="crumbs">
            {group.label && <span>{group.label}</span>}
            {group.label && <span aria-hidden="true">/</span>}
            <strong>{item.label}</strong>
          </div>
          <div className="topbar__spacer" />
          <div className="profile" ref={menuRef}>
            <button aria-expanded={menuOpen} aria-haspopup="menu" className="profile__btn" onClick={() => setMenuOpen((o) => !o)} type="button">
              <span className="avatar">{admin.email.slice(0, 1)}</span>
              <span className="profile__who">
                <span className="profile__email">{admin.email}</span>
                <span className="profile__role">{admin.role}</span>
              </span>
            </button>
            {menuOpen && (
              <div className="menu" role="menu">
                <div className="menu__meta">
                  Signed in as
                  <br />
                  <strong style={{ color: 'var(--cup-black)' }}>{admin.email}</strong>
                </div>
                <button className="menu__item" onClick={onLogout} role="menuitem" type="button">
                  <Icon name="logout" />
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
        <main className="page" key={page}>
          {children}
        </main>
      </div>
    </div>
    </PulseContext.Provider>
  );
}
