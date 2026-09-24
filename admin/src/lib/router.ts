import { useCallback, useEffect, useState } from 'react';
import { AdminPage, NAV_GROUPS } from './nav';

// A small, dependency-free router (native History API — no react-router, per the Sidebar/Finance
// refactor's own "avoid unnecessary dependencies" instruction). Every AdminPage's URL is decided
// once, in nav.ts's own `path` field — this file only maps a path back to a page id and drives
// history.pushState/popstate, so a page can be opened directly, refreshed, opened in a new tab, or
// reached via Back/Forward, exactly like any ordinary page.
const PATH_TO_PAGE = new Map<string, AdminPage>(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.path, i.id] as const)));

export function pageForPath(pathname: string): AdminPage {
  return PATH_TO_PAGE.get(pathname) ?? 'dashboard';
}

export function pathForPage(id: AdminPage): string {
  for (const g of NAV_GROUPS) {
    const item = g.items.find((i) => i.id === id);
    if (item) return item.path;
  }
  return '/admin/dashboard';
}

// The ONE hook App.tsx uses in place of the old `useState<AdminPage>('dashboard')`. `navigate`
// both updates the page and pushes a real history entry; popstate (Back/Forward) is the only other
// way the page can change here, so the URL and the rendered page can never drift apart.
export function useAdminRoute(): { page: AdminPage; navigate: (id: AdminPage) => void } {
  const [page, setPage] = useState<AdminPage>(() => pageForPath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setPage(pageForPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((id: AdminPage) => {
    const path = pathForPage(id);
    if (path !== window.location.pathname) window.history.pushState(null, '', path);
    setPage(id);
  }, []);

  return { page, navigate };
}
