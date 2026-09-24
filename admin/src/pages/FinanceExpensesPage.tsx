import { findNav } from '../lib/nav';
import { FinanceExpensesTab } from '../components/FinanceExpensesTab';
import { PageHeader } from '../ui';

export function FinanceExpensesPage() {
  const { item } = findNav('finance-expenses');
  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FinanceExpensesTab />
    </>
  );
}
