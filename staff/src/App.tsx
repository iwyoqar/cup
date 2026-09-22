import { useEffect, useState } from 'react';
import { clearStoredToken, getStoredToken } from './lib/api';
import { goCustomers, goRecent, goScan, Route, useRoute } from './lib/route';
import { fetchStaffMe, StaffProfile } from './lib/staffApi';
import { CustomersPage } from './pages/CustomersPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { RecentPage } from './pages/RecentPage';
import { ScanPage } from './pages/ScanPage';

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
      <main className="login">
        <div className="brand">CUP</div>
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
    <div className="shell">
      <header className="topbar">
        <div className="topbar__left">
          <span className="brand brand--small">CUP</span>
          <span className="topbar__meta">
            {staff.displayName} · {staff.branch ? staff.branch.name : 'Filial belgilanmagan'}
          </span>
        </div>
        <button className="topbar__logout" onClick={logout} type="button">
          Chiqish
        </button>
      </header>
      <nav aria-label="Bo‘limlar" className="tabs">
        {TABS.map((t) => (
          <button aria-current={route.name === t.name ? 'page' : undefined} className={`tabs__tab${route.name === t.name ? ' tabs__tab--on' : ''}`} key={t.name} onClick={t.go} type="button">
            {t.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {route.name === 'scan' && <ScanPage />}
        {route.name === 'customers' && <CustomersPage onSessionExpired={logout} />}
        {route.name === 'recent' && <RecentPage onSessionExpired={logout} />}
        {route.name === 'customer' && <ProfilePage code={route.code} key={route.code} onSessionExpired={logout} staff={staff} />}
      </main>
    </div>
  );
}
