import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { deriveHealth, overallState, PulseContext, pulseAttention, useSystemPulse } from '../lib/health';
import { AdminPage, findNav, groupOf, NavGroup, NAV_GROUPS, NavItem } from '../lib/nav';
import { AdminProfile } from '../lib/types';
import { IconButton } from './Button';
import { cx } from './cx';
import { Icon } from './icons';
import { HEALTH_DOT } from './StatusBadge';

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

function NavLink({ it, active, attention, onClick, tabbable = true }: { it: NavItem; active: boolean; attention: boolean; onClick: () => void; tabbable?: boolean }) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={cx(
        'group relative flex h-9 w-full items-center gap-3 rounded-sm px-3 text-left text-[13.5px] transition-colors duration-150',
        active ? 'bg-white/10 font-semibold text-white' : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white',
      )}
      onClick={onClick}
      tabIndex={tabbable ? 0 : -1}
      title={it.label}
      type="button"
    >
      {active && <span aria-hidden="true" className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-terracotta" />}
      <Icon className={cx('size-[17px]', active ? 'text-cream' : 'text-white/55 group-hover:text-white/80')} name={it.icon} />
      <span className="min-w-0 flex-1 truncate">{it.label}</span>
      {attention && <span aria-label="Needs attention" className="size-2 shrink-0 rounded-full bg-terracotta" />}
    </button>
  );
}

// One collapsible section: a real <button> header (aria-expanded / aria-controls, keyboard-operable) plus its items. The
// panel animates open with a grid-rows + opacity transition; collapsed items leave the tab order.
function NavSection({ g, active, open, attention, onToggle, onNavigate }: { g: NavGroup; active: AdminPage; open: boolean; attention: Partial<Record<AdminPage, boolean>>; onToggle: () => void; onNavigate: (id: AdminPage) => void }) {
  const panelId = useId();
  const hasActive = g.items.some((i) => i.id === active);
  const hasAttention = g.items.some((i) => attention[i.id]);
  return (
    <div className="mt-1">
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className={cx('flex h-8 w-full items-center gap-2 rounded-sm px-3 text-[11px] font-semibold tracking-[0.14em] uppercase transition-colors duration-150', hasActive ? 'text-cream' : 'text-white/45 hover:text-white/80')}
        onClick={onToggle}
        type="button"
      >
        <span className="flex-1 text-left">{g.label}</span>
        {!open && hasAttention && <span aria-hidden="true" className="size-1.5 rounded-full bg-terracotta" />}
        <Icon className={cx('size-3.5 transition-transform duration-200 ease-out', open && 'rotate-90')} name="chevron" />
      </button>
      <div className={cx('grid transition-[grid-template-rows,opacity] duration-200 ease-out', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')} id={panelId}>
        <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden pt-0.5 pb-1.5 pl-3">
          {g.items.map((it) => (
            <NavLink attention={!!attention[it.id]} active={it.id === active} it={it} key={it.id} onClick={() => onNavigate(it.id)} tabbable={open} />
          ))}
        </div>
      </div>
    </div>
  );
}

// The Admin frame: a black sidebar (CUP's structural black) with an exclusive accordion of grouped navigation, a quiet
// sticky top bar with breadcrumb + account menu, and a centred content column. Below 1024 px the sidebar becomes a drawer
// opened from the top bar.
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
    if (!menuOpen && !navOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setNavOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, navOpen]);

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
      <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside
          aria-label="Primary"
          className={cx(
            'fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col bg-black text-white transition-transform duration-250 ease-out lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-auto lg:translate-x-0',
            navOpen ? 'translate-x-0 shadow-pop' : '-translate-x-full',
          )}
        >
          <div className="flex h-16 shrink-0 items-center gap-3 px-6">
            <span className="font-display text-[22px] tracking-[0.3em] text-white">CUP</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-cream uppercase">Admin</span>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-color:rgb(255_255_255/0.15)_transparent] [scrollbar-width:thin]">
            {NAV_GROUPS.map((g) =>
              g.label === null ? (
                // The one non-collapsible group (Dashboard) — no header, always rendered.
                <div className="mb-2 flex flex-col gap-0.5 pl-3" key={g.id}>
                  {g.items.map((it) => (
                    <NavLink attention={!!attention[it.id]} active={it.id === page} it={it} key={it.id} onClick={() => go(it.id)} />
                  ))}
                </div>
              ) : (
                <NavSection active={page} attention={attention} g={g} key={g.id} onNavigate={go} onToggle={() => toggleSection(g.id)} open={openSection === g.id} />
              ),
            )}
          </nav>
          <button className="m-3 flex items-center gap-3 rounded-md border border-sidebar-line px-3 py-2.5 text-left transition-colors duration-150 hover:bg-sidebar-hover" onClick={() => go('system-health')} title="Open System Health" type="button">
            <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-full', HEALTH_DOT[pulse.loading ? 'unknown' : overall])} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-white">{statusTitle}</span>
              <span className="block truncate text-[11px] text-white/50">{statusSub}</span>
            </span>
          </button>
        </aside>
        <div aria-hidden="true" className={cx('fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 lg:hidden', navOpen ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={() => setNavOpen(false)} />

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md md:px-8">
            <IconButton aria-expanded={navOpen} className="-ml-2 lg:hidden" label="Open navigation" onClick={() => setNavOpen(true)}>
              <Icon name="menu" />
            </IconButton>
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
              {group.label && <span className="hidden truncate sm:inline">{group.label}</span>}
              {group.label && (
                <span aria-hidden="true" className="hidden text-line-strong sm:inline">
                  /
                </span>
              )}
              <strong className="truncate font-semibold text-black">{item.label}</strong>
            </nav>
            <div className="flex-1" />
            <div className="relative" ref={menuRef}>
              <button aria-expanded={menuOpen} aria-haspopup="menu" className="flex items-center gap-2.5 rounded-full border border-line bg-white py-1 pr-3 pl-1 transition-colors duration-150 hover:border-line-strong" onClick={() => setMenuOpen((o) => !o)} type="button">
                <span className="grid size-7 place-items-center rounded-full bg-black font-display text-sm text-cream uppercase">{admin.email.slice(0, 1)}</span>
                <span className="hidden flex-col text-left leading-tight sm:flex">
                  <span className="max-w-[200px] truncate text-[13px] font-semibold">{admin.email}</span>
                  <span className="text-[10px] font-semibold tracking-[0.1em] text-muted uppercase">{admin.role}</span>
                </span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-64 animate-menu-in rounded-md border border-line bg-white p-1.5 shadow-menu" role="menu">
                  <div className="border-b border-line px-3 py-2.5 text-xs text-muted">
                    Signed in as
                    <strong className="mt-0.5 block truncate text-sm text-black">{admin.email}</strong>
                  </div>
                  <button className="mt-1 flex h-9 w-full items-center gap-2.5 rounded-sm px-3 text-left text-sm transition-colors duration-150 hover:bg-hover" onClick={onLogout} role="menuitem" type="button">
                    <Icon className="size-4 text-muted" name="logout" />
                    Log out
                  </button>
                </div>
              )}
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1440px] min-w-0 animate-rise-in px-4 py-6 md:px-8 md:py-8" key={page}>
            {children}
          </main>
        </div>
      </div>
    </PulseContext.Provider>
  );
}
