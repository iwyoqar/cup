import { useEffect, useState } from 'react';
import { fetchMe } from './lib/adminAuth';
import { clearStoredToken, getStoredToken } from './lib/api';
import { AdminPage } from './lib/nav';
import { AdminProfile } from './lib/types';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CustomersPage } from './pages/CustomersPage';
import { SegmentsPage } from './pages/SegmentsPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { PromotionsPage } from './pages/PromotionsPage';
import { RewardProgramsPage } from './pages/RewardProgramsPage';
import { LoyaltyPage } from './pages/LoyaltyPage';
import { AutomationsPage } from './pages/AutomationsPage';
import { ReferralsPage } from './pages/ReferralsPage';
import { GrowthPage } from './pages/GrowthPage';
import { BranchIntelligencePage } from './pages/BranchIntelligencePage';
import { FinancePage } from './pages/FinancePage';
import { BranchConfigPage } from './pages/BranchConfigPage';
import { StaffPage } from './pages/StaffPage';
import { PosterImportPage } from './pages/PosterImportPage';
import { ContinuousSyncPage } from './pages/ContinuousSyncPage';
import { SystemHealthPage } from './pages/SystemHealthPage';
import { ErrorsPage } from './pages/ErrorsPage';
import { AuditPage } from './pages/AuditPage';
import { AdminShell, LoadingState } from './ui';

type Phase = 'booting' | 'login' | 'authenticated';

export function App() {
  const [phase, setPhase] = useState<Phase>('booting');
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [page, setPage] = useState<AdminPage>('dashboard');

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setPhase('login');
      return;
    }
    // A stored token from a previous session — verify it's still valid rather than trusting
    // its mere presence (it may have expired, or the admin may have been deactivated since).
    fetchMe()
      .then((profile) => {
        setAdmin(profile);
        setPhase('authenticated');
      })
      .catch(() => {
        clearStoredToken();
        setPhase('login');
      });
  }, []);

  const handleLogout = () => {
    clearStoredToken();
    setAdmin(null);
    setPage('dashboard');
    setPhase('login');
  };

  if (phase === 'booting') {
    return (
      <div className="login-screen">
        <div style={{ width: 200 }}>
          <LoadingState variant="inline" />
        </div>
      </div>
    );
  }

  if (phase === 'login' || !admin) {
    return (
      <LoginPage
        onLoggedIn={(loggedInAdmin) => {
          setAdmin(loggedInAdmin);
          setPhase('authenticated');
        }}
      />
    );
  }

  return (
    <AdminShell admin={admin} onLogout={handleLogout} onNavigate={setPage} page={page}>
      {page === 'dashboard' && <DashboardPage admin={admin} onNavigate={setPage} />}
      {page === 'sales' && <AnalyticsPage view="sales" />}
      {page === 'analytics' && <AnalyticsPage view="analytics" />}
      {page === 'customers' && <CustomersPage />}
      {page === 'segments' && <SegmentsPage />}
      {page === 'loyalty' && <LoyaltyPage />}
      {page === 'rewards' && <RewardProgramsPage />}
      {page === 'promotions' && <PromotionsPage />}
      {page === 'referrals' && <ReferralsPage />}
      {page === 'campaigns' && <CampaignsPage />}
      {page === 'crm-automation' && <AutomationsPage />}
      {page === 'pos-import' && <PosterImportPage onNavigate={setPage} />}
      {page === 'continuous-sync' && <ContinuousSyncPage />}
      {page === 'staff' && <StaffPage />}
      {page === 'growth' && <GrowthPage />}
      {page === 'branch-intelligence' && <BranchIntelligencePage />}
      {page === 'finance' && <FinancePage />}
      {page === 'branch-config' && <BranchConfigPage />}
      {page === 'system-health' && <SystemHealthPage />}
      {page === 'errors' && <ErrorsPage onNavigate={setPage} />}
      {page === 'audit' && <AuditPage />}
    </AdminShell>
  );
}
