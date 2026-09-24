import type { IconName } from '../ui/icons';

// The Admin's information architecture: ONE place that says which pages exist, how they are grouped, how each one
// is introduced (the shell's breadcrumb and every page header read from here, so a page can never be titled two
// different ways) — and, since the Sidebar/Finance refactor, its URL. `router.ts` is the only other file that
// knows about paths, and it reads them from here rather than duplicating them.
export type AdminPage =
  | 'dashboard'
  | 'sales'
  | 'customers'
  | 'segments'
  | 'loyalty'
  | 'rewards'
  | 'rewards-5plus1'
  | 'promotions'
  | 'referrals'
  | 'campaigns'
  | 'crm-automation'
  | 'pos-import'
  | 'continuous-sync'
  | 'staff'
  | 'analytics'
  | 'reports-overview'
  | 'reports-sales'
  | 'reports-locations'
  | 'reports-payments'
  | 'reports-products'
  | 'reports-categories'
  | 'growth'
  | 'branch-intelligence'
  | 'finance'
  | 'finance-pnl'
  | 'finance-cash-flow'
  | 'finance-expenses'
  | 'finance-loans'
  | 'finance-taxes'
  | 'finance-investments'
  | 'finance-reconciliation'
  | 'branch-config'
  | 'system-health'
  | 'errors'
  | 'audit';

export interface NavItem {
  id: AdminPage;
  label: string;
  icon: IconName;
  description: string;
  path: string; // e.g. "/admin/finance/pnl" — the one place a page's URL is decided
}

export interface NavGroup {
  id: string;
  label: string | null; // null = not a collapsible section (Dashboard only) — always rendered, never has a chevron
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: null,
    items: [{ id: 'dashboard', label: 'Dashboard', icon: 'dashboard', description: 'How the business is doing right now.', path: '/admin/dashboard' }],
  },
  {
    id: 'commerce',
    label: 'Commerce',
    items: [
      { id: 'sales', label: 'Sales', icon: 'sales', description: 'Revenue, orders and what sells — CUP and Poster POS together.', path: '/admin/sales' },
      { id: 'customers', label: 'Customers', icon: 'customers', description: 'Find customers and review their loyalty, rewards and activity.', path: '/admin/customers' },
      { id: 'segments', label: 'Segments', icon: 'segments', description: 'Rule-based customer groups used by campaigns and automation.', path: '/admin/segments' },
    ],
  },
  {
    id: 'loyalty',
    label: 'Loyalty & Rewards',
    items: [
      { id: 'loyalty', label: 'Loyalty', icon: 'loyalty', description: 'Points, levels, XP, cashback, streaks and achievements.', path: '/admin/loyalty' },
      { id: 'rewards', label: 'Rewards', icon: 'rewards', description: 'Buy-X-get-Y reward programs, their progress and redemptions.', path: '/admin/rewards' },
      { id: 'rewards-5plus1', label: '5+1 Coffee', icon: 'rewards', description: 'Participation, free coffees redeemed, top customers and redemption history.', path: '/admin/rewards/5-plus-1' },
      { id: 'promotions', label: 'Promotions', icon: 'promotions', description: 'Discounts and benefits: who is eligible and how they are used.', path: '/admin/promotions' },
      { id: 'referrals', label: 'Referrals', icon: 'referrals', description: 'Referral program rules, attribution and rewards.', path: '/admin/referrals' },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    items: [
      { id: 'campaigns', label: 'Campaigns', icon: 'campaigns', description: 'Compose, target and send messages to customers.', path: '/admin/campaigns' },
      { id: 'crm-automation', label: 'CRM Automation', icon: 'automation', description: 'Automated messages triggered by customer events.', path: '/admin/crm-automation' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'pos-import', label: 'POS Import', icon: 'import', description: 'Bring Poster POS receipts into CUP: preview, review, confirm.', path: '/admin/pos-import' },
      { id: 'continuous-sync', label: 'Continuous Sync', icon: 'sync', description: 'Automatic Poster import: webhooks, queue and recovery.', path: '/admin/continuous-sync' },
      { id: 'staff', label: 'Staff', icon: 'staff', description: 'Barista accounts for the Staff Panel.', path: '/admin/staff' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { id: 'analytics', label: 'Analytics', icon: 'analytics', description: 'Customers, sources and product performance over any period.', path: '/admin/analytics' },
      { id: 'growth', label: 'Growth Intelligence', icon: 'growth', description: 'Lifecycle, RFM and opportunities across all customers.', path: '/admin/growth' },
      { id: 'branch-intelligence', label: 'Branch Intelligence', icon: 'branch', description: 'Branch-by-branch performance, mix and customer behaviour.', path: '/admin/branch-intelligence' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    items: [
      { id: 'reports-overview', label: 'Overview', icon: 'analytics', description: 'Operational dashboard: revenue, orders, customers and trends.', path: '/admin/reports/overview' },
      { id: 'reports-sales', label: 'Sales', icon: 'sales', description: 'Sales report: summary, trends, source split and top products.', path: '/admin/reports/sales' },
      { id: 'reports-locations', label: 'Locations', icon: 'branch', description: 'Branch performance for the selected period.', path: '/admin/reports/locations' },
      { id: 'reports-payments', label: 'Payments', icon: 'finance', description: 'How sales were paid — payment methods as reported by Poster POS.', path: '/admin/reports/payments' },
      { id: 'reports-products', label: 'Products', icon: 'sales', description: 'Which products sell, the revenue they bring and their theoretical cost.', path: '/admin/reports/products' },
      { id: 'reports-categories', label: 'Categories', icon: 'segments', description: 'How sales are distributed across product categories.', path: '/admin/reports/categories' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { id: 'finance', label: 'Overview', icon: 'finance', description: 'The full financial picture at a glance — revenue, profit, cash flow, break-even.', path: '/admin/finance' },
      { id: 'finance-pnl', label: 'P&L', icon: 'finance', description: 'Revenue, COGS, gross/operating/net profit for a period and branch.', path: '/admin/finance/pnl' },
      { id: 'finance-cash-flow', label: 'Cash Flow', icon: 'finance', description: 'Real cash in and out — never the same as accounting profit.', path: '/admin/finance/cash-flow' },
      { id: 'finance-expenses', label: 'Expenses', icon: 'finance', description: 'Operating and financial expenses, one-time and recurring.', path: '/admin/finance/expenses' },
      { id: 'finance-loans', label: 'Loans', icon: 'finance', description: 'Principal, interest, payments and outstanding balance.', path: '/admin/finance/loans' },
      { id: 'finance-taxes', label: 'Taxes', icon: 'finance', description: 'Configurable tax rules and their computed liability.', path: '/admin/finance/taxes' },
      { id: 'finance-investments', label: 'Investment & Payback', icon: 'finance', description: 'Initial investment, cumulative cash flow, payback and ROI.', path: '/admin/finance/investments' },
      { id: 'finance-reconciliation', label: 'Reconciliation', icon: 'finance', description: 'Verifies recognized revenue against a live Poster read.', path: '/admin/finance/reconciliation' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { id: 'branch-config', label: 'Branch Configuration', icon: 'branch', description: 'Branches and their Poster spot mapping.', path: '/admin/branch-config' },
      { id: 'system-health', label: 'System Health', icon: 'health', description: 'Is every part of CUP up and configured?', path: '/admin/system-health' },
      { id: 'errors', label: 'Errors', icon: 'errors', description: 'Everything that currently needs attention.', path: '/admin/errors' },
      { id: 'audit', label: 'Audit', icon: 'audit', description: 'A trail of what was imported, received and changed.', path: '/admin/audit' },
    ],
  },
];

export function findNav(id: AdminPage): { item: NavItem; group: NavGroup } {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => i.id === id);
    if (item) return { item, group };
  }
  // Unreachable while AdminPage is derived from the same list; a safe fallback keeps the shell rendering.
  const group = NAV_GROUPS[0];
  return { item: group.items[0], group };
}

// The group a given page's section-accordion lives in — null for the non-collapsible Dashboard group.
export function groupOf(id: AdminPage): NavGroup | null {
  const { group } = findNav(id);
  return group.label === null ? null : group;
}
