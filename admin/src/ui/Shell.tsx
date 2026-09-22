import { ReactNode, useEffect, useRef, useState } from 'react';
import { deriveHealth, overallState, PulseContext, pulseAttention, useSystemPulse } from '../lib/health';
import { AdminPage, findNav, NAV_GROUPS } from '../lib/nav';
import { AdminProfile } from '../lib/types';
import { Icon } from './icons';

interface AdminShellProps {
  page: AdminPage;
  onNavigate: (page: AdminPage) => void;
  onLogout: () => void;
  admin: AdminProfile;
  children: ReactNode;
}

// The Admin frame: a black sidebar (the Mini App's structural black) with grouped navigation, a quiet top bar with breadcrumb + account, and a
// centred content column. Below 1100 px the sidebar collapses to an icon rail; below 760 px it becomes a drawer opened from the top bar.
export function AdminShell({ page, onNavigate, onLogout, admin, children }: AdminShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pulse = useSystemPulse();
  const attention = pulseAttention(pulse);
  const health = deriveHealth(pulse);
  const overall = overallState(health);
  const { item, group } = findNav(page);

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
          {NAV_GROUPS.map((g) => (
            <div className="nav-group" key={g.id}>
              {g.label && <div className="nav-group__label">{g.label}</div>}
              {g.items.map((it) => (
                <button
                  aria-current={it.id === page ? 'page' : undefined}
                  className={`nav-item${it.id === page ? ' nav-item--active' : ''}`}
                  key={it.id}
                  onClick={() => go(it.id)}
                  title={it.label}
                  type="button"
                >
                  <Icon name={it.icon} />
                  <span className="nav-item__label">{it.label}</span>
                  {attention[it.id] && <span aria-label="Needs attention" className="nav-item__attention" />}
                </button>
              ))}
            </div>
          ))}
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
