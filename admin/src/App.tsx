import { useEffect, useState } from 'react';
import { fetchMe } from './lib/adminAuth';
import { clearStoredToken, getStoredToken } from './lib/api';
import { useAdminRoute } from './lib/router';
import { AdminProfile } from './lib/types';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ReportsOverviewPage } from './pages/ReportsOverviewPage';
import { ReportsSalesPage } from './pages/ReportsSalesPage';
import { ReportsLocationsPage } from './pages/ReportsLocationsPage';
import { CustomersPage } from './pages/CustomersPage';
import { SegmentsPage } from './pages/SegmentsPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { PromotionsPage } from './pages/PromotionsPage';
import { RewardProgramsPage } from './pages/RewardProgramsPage';
import { FivePlusOneReportPage } from './pages/FivePlusOneReportPage';
import { LoyaltyPage } from './pages/LoyaltyPage';
import { AutomationsPage } from './pages/AutomationsPage';
import { ReferralsPage } from './pages/ReferralsPage';
import { GrowthPage } from './pages/GrowthPage';
import { BranchIntelligencePage } from './pages/BranchIntelligencePage';
import { FinanceOverviewPage } from './pages/FinanceOverviewPage';
import { FinancePnlPage } from './pages/FinancePnlPage';
import { FinanceCashFlowPage } from './pages/FinanceCashFlowPage';
import { FinanceExpensesPage } from './pages/FinanceExpensesPage';
import { FinanceLoansPage } from './pages/FinanceLoansPage';
import { FinanceTaxesPage } from './pages/FinanceTaxesPage';
import { FinanceInvestmentsPage } from './pages/FinanceInvestmentsPage';
import { FinanceReconciliationPage } from './pages/FinanceReconciliationPage';
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
  const { page, navigate } = useAdminRoute();

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
    navigate('dashboard');
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
    <AdminShell admin={admin} onLogout={handleLogout} onNavigate={navigate} page={page}>
      {page === 'dashboard' && <DashboardPage admin={admin} onNavigate={navigate} />}
      {page === 'sales' && <AnalyticsPage view="sales" />}
      {page === 'analytics' && <AnalyticsPage view="analytics" />}
      {page === 'reports-overview' && <ReportsOverviewPage />}
      {page === 'reports-sales' && <ReportsSalesPage />}
      {page === 'reports-locations' && <ReportsLocationsPage />}
      {page === 'customers' && <CustomersPage />}
      {page === 'segments' && <SegmentsPage />}
      {page === 'loyalty' && <LoyaltyPage />}
      {page === 'rewards' && <RewardProgramsPage />}
      {page === 'rewards-5plus1' && <FivePlusOneReportPage />}
      {page === 'promotions' && <PromotionsPage />}
      {page === 'referrals' && <ReferralsPage />}
      {page === 'campaigns' && <CampaignsPage />}
      {page === 'crm-automation' && <AutomationsPage />}
      {page === 'pos-import' && <PosterImportPage onNavigate={navigate} />}
      {page === 'continuous-sync' && <ContinuousSyncPage />}
      {page === 'staff' && <StaffPage />}
      {page === 'growth' && <GrowthPage />}
      {page === 'branch-intelligence' && <BranchIntelligencePage />}
      {page === 'finance' && <FinanceOverviewPage />}
      {page === 'finance-pnl' && <FinancePnlPage />}
      {page === 'finance-cash-flow' && <FinanceCashFlowPage />}
      {page === 'finance-expenses' && <FinanceExpensesPage />}
      {page === 'finance-loans' && <FinanceLoansPage />}
      {page === 'finance-taxes' && <FinanceTaxesPage />}
      {page === 'finance-investments' && <FinanceInvestmentsPage />}
      {page === 'finance-reconciliation' && <FinanceReconciliationPage />}
      {page === 'branch-config' && <BranchConfigPage />}
      {page === 'system-health' && <SystemHealthPage />}
      {page === 'errors' && <ErrorsPage onNavigate={navigate} />}
      {page === 'audit' && <AuditPage />}
    </AdminShell>
  );
}
