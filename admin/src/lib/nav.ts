import type { IconName } from '../ui/icons';

// The Admin's information architecture: ONE place that says which pages exist, how they are grouped, and how each one is introduced
// (the shell's breadcrumb and every page header read from here, so a page can never be titled two different ways).
export type AdminPage =
  | 'dashboard'
  | 'sales'
  | 'customers'
  | 'segments'
  | 'loyalty'
  | 'rewards'
  | 'promotions'
  | 'referrals'
  | 'campaigns'
  | 'crm-automation'
  | 'pos-import'
  | 'continuous-sync'
  | 'staff'
  | 'analytics'
  | 'growth'
  | 'branch-intelligence'
  | 'finance'
  | 'branch-config'
  | 'system-health'
  | 'errors'
  | 'audit';

export interface NavItem {
  id: AdminPage;
  label: string;
  icon: IconName;
  description: string;
}

export interface NavGroup {
  id: string;
  label: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: null,
    items: [{ id: 'dashboard', label: 'Dashboard', icon: 'dashboard', description: 'How the business is doing right now.' }],
  },
  {
    id: 'commerce',
    label: 'Commerce',
    items: [
      { id: 'sales', label: 'Sales', icon: 'sales', description: 'Revenue, orders and what sells — CUP and Poster POS together.' },
      { id: 'customers', label: 'Customers', icon: 'customers', description: 'Find customers and review their loyalty, rewards and activity.' },
      { id: 'segments', label: 'Segments', icon: 'segments', description: 'Rule-based customer groups used by campaigns and automation.' },
    ],
  },
  {
    id: 'loyalty',
    label: 'Loyalty & Rewards',
    items: [
      { id: 'loyalty', label: 'Loyalty', icon: 'loyalty', description: 'Points, levels, XP, cashback, streaks and achievements.' },
      { id: 'rewards', label: 'Rewards', icon: 'rewards', description: 'Buy-X-get-Y reward programs, their progress and redemptions.' },
      { id: 'promotions', label: 'Promotions', icon: 'promotions', description: 'Discounts and benefits: who is eligible and how they are used.' },
      { id: 'referrals', label: 'Referrals', icon: 'referrals', description: 'Referral program rules, attribution and rewards.' },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    items: [
      { id: 'campaigns', label: 'Campaigns', icon: 'campaigns', description: 'Compose, target and send messages to customers.' },
      { id: 'crm-automation', label: 'CRM Automation', icon: 'automation', description: 'Automated messages triggered by customer events.' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'pos-import', label: 'POS Import', icon: 'import', description: 'Bring Poster POS receipts into CUP: preview, review, confirm.' },
      { id: 'continuous-sync', label: 'Continuous Sync', icon: 'sync', description: 'Automatic Poster import: webhooks, queue and recovery.' },
      { id: 'staff', label: 'Staff', icon: 'staff', description: 'Barista accounts for the Staff Panel.' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { id: 'analytics', label: 'Analytics', icon: 'analytics', description: 'Customers, sources and product performance over any period.' },
      { id: 'growth', label: 'Growth Intelligence', icon: 'growth', description: 'Lifecycle, RFM and opportunities across all customers.' },
      { id: 'branch-intelligence', label: 'Branch Intelligence', icon: 'branch', description: 'Branch-by-branch performance, mix and customer behaviour.' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [{ id: 'finance', label: 'Finance', icon: 'finance', description: 'Revenue, COGS, expenses, loans, taxes, investment and payback — the full financial picture.' }],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { id: 'branch-config', label: 'Branch Configuration', icon: 'branch', description: 'Branches and their Poster spot mapping.' },
      { id: 'system-health', label: 'System Health', icon: 'health', description: 'Is every part of CUP up and configured?' },
      { id: 'errors', label: 'Errors', icon: 'errors', description: 'Everything that currently needs attention.' },
      { id: 'audit', label: 'Audit', icon: 'audit', description: 'A trail of what was imported, received and changed.' },
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
