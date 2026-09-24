import { findNav } from '../lib/nav';
import { FinanceLoansTab } from '../components/FinanceLoansTab';
import { PageHeader } from '../ui';

export function FinanceLoansPage() {
  const { item } = findNav('finance-loans');
  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FinanceLoansTab />
    </>
  );
}
