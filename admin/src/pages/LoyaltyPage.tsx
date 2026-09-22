import { useState } from 'react';
import { findNav } from '../lib/nav';
import { PageHeader, Tabs } from '../ui';
import { Loyalty2Page } from './Loyalty2Page';
import { LoyaltySettingsPage } from './LoyaltySettingsPage';

type Tab = 'points' | 'levels';

// One "Loyalty" home for both loyalty configuration pages that already existed: the points program (earn rule, redemption) and Loyalty 2.0 (levels, XP,
// cashback, streak, achievements, birthday). Both are configuration — nothing is earned until a program is switched on — so they are separated from
// operational data (customer balances live on each customer's profile, reward progress under Rewards).
export function LoyaltyPage() {
  const [tab, setTab] = useState<Tab>('points');
  const { item } = findNav('loyalty');
  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <Tabs
        active={tab}
        label="Loyalty configuration"
        onChange={setTab}
        tabs={[
          { id: 'points', label: 'Points & earning' },
          { id: 'levels', label: 'Levels, XP & achievements' },
        ]}
      />
      <div className="narrow">{tab === 'points' ? <LoyaltySettingsPage /> : <Loyalty2Page />}</div>
    </>
  );
}
