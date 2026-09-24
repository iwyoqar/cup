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

// Exclusive accordion: at most one top-level section is open at a time (string id, or null for none). Reads the
// legacy multi-section format (a JSON array of open ids, from before this fix) and migrates it down to a single id —
// the active route's own section first, else the array's first entry, else null — then persists the normalized
// value back under the SAME key (no new storage key introduced).
function loadOpenSection(activeGroupId: string | null): string | null {
  let stored: unknown = null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {
    stored = null; // blocked/unavailable storage — falls back to in-memory state (still works for the session)
  }

  let normalized: string | null;
  if (activeGroupId) {
    normalized = activeGroupId; // the active route's section always wins over whatever was stored
  } else if (typeof stored === 'string') {
    normalized = stored;
  } else if (Array.isArray(stored)) {
    normalized = stored.find((v): v is string => typeof v === 'string') ?? null; // legacy multi-open array — keep only the first
  } else {
    normalized = null;
  }

  saveOpenSection(normalized);
  return normalized;
}

function saveOpenSection(id: string | null): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
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

  // Exclusive accordion: only the section containing the initial route auto-opens; everything after that is persisted.
  const [openSection, setOpenSection] = useState<string | null>(() => loadOpenSection(groupOf(page)?.id ?? null));

  useEffect(() => saveOpenSection(openSection), [openSection]);

  // A route change always makes its own section the (only) open one — this is what closes whichever section was
  // open before, so two top-level sections can never be open at once.
  useEffect(() => {
    const active = groupOf(page);
    if (!active) return;
    setOpenSection((prev) => (prev === active.id ? prev : active.id));
  }, [page]);

  const toggleSection = (id: string) => {
    setOpenSection((prev) => (prev === id ? null : id));
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
              <NavSection active={page} attention={attention} g={g} key={g.id} onNavigate={go} onToggle={() => toggleSection(g.id)} open={openSection === g.id} />
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
