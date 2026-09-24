import { findNav } from '../lib/nav';
import { FinanceInvestmentsTab } from '../components/FinanceInvestmentsTab';
import { PageHeader } from '../ui';

export function FinanceInvestmentsPage() {
  const { item } = findNav('finance-investments');
  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FinanceInvestmentsTab />
    </>
  );
}
