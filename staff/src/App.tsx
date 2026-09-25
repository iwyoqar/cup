import { useEffect, useState } from 'react';
import { clearStoredToken, getStoredToken } from './lib/api';
import { goCustomers, goRecent, goScan, Route, useRoute } from './lib/route';
import { fetchStaffMe, StaffProfile } from './lib/staffApi';
import { CustomersPage } from './pages/CustomersPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { RecentPage } from './pages/RecentPage';
import { ScanPage } from './pages/ScanPage';
import { cx } from './lib/cx';

type Phase = 'booting' | 'login' | 'ready';

const TABS: { name: Route['name']; label: string; go: () => void }[] = [
  { name: 'scan', label: 'Skaner', go: goScan },
  { name: 'customers', label: 'Mijozlar', go: goCustomers },
  { name: 'recent', label: 'So‘nggilar', go: goRecent },
];

export function App() {
  const [phase, setPhase] = useState<Phase>('booting');
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const route = useRoute();

  useEffect(() => {
    if (!getStoredToken()) {
      setPhase('login');
      return;
    }
    // A stored token is verified, not trusted: it may have expired or the account may have been deactivated.
    fetchStaffMe()
      .then((profile) => {
        setStaff(profile);
        setPhase('ready');
      })
      .catch(() => {
        clearStoredToken();
        setPhase('login');
      });
  }, []);

  const logout = () => {
    clearStoredToken();
    setStaff(null);
    setPhase('login');
  };

  if (phase === 'booting') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col gap-4 px-5 py-12">
        <div className="font-display text-[32px] font-semibold tracking-[0.32em] whitespace-nowrap">CUP</div>
      </main>
    );
  }

  if (phase === 'login' || !staff) {
    return (
      <LoginPage
        onLoggedIn={(profile) => {
          setStaff(profile);
          setPhase('ready');
        }}
      />
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-[1040px]">
      <header className="sticky top-0 z-5 flex items-center justify-between gap-3 bg-black px-4 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5 text-white">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <span className="font-display text-[18px] font-semibold tracking-[0.32em] whitespace-nowrap text-white">CUP</span>
          <span className="overflow-hidden text-[13px] text-ellipsis whitespace-nowrap text-cream">
            {staff.displayName} · {staff.branch ? staff.branch.name : 'Filial belgilanmagan'}
          </span>
        </div>
        <button className="min-h-10 shrink-0 cursor-pointer rounded-sm border border-white/40 bg-transparent px-3.5 text-[13px] font-semibold text-white" onClick={logout} type="button">
          Chiqish
        </button>
      </header>
      <nav aria-label="Bo‘limlar" className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-2">
        {TABS.map((t) => (
          <button aria-current={route.name === t.name ? 'page' : undefined} className={cx('font-[inherit] leading-[inherit] min-h-12 flex-1 cursor-pointer border-x-0 border-t-0 border-b-[3px] bg-transparent text-[14px] font-bold tracking-[0.04em] whitespace-nowrap', route.name === t.name ? 'border-terracotta text-black' : 'border-transparent text-muted')} key={t.name} onClick={t.go} type="button">
            {t.label}
          </button>
        ))}
      </nav>
      <main>
        {route.name === 'scan' && <ScanPage />}
        {route.name === 'customers' && <CustomersPage onSessionExpired={logout} />}
        {route.name === 'recent' && <RecentPage onSessionExpired={logout} />}
        {route.name === 'customer' && <ProfilePage code={route.code} key={route.code} onSessionExpired={logout} staff={staff} />}
      </main>
    </div>
  );
}
