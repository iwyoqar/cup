import { findNav } from '../lib/nav';
import { FinanceTaxesTab } from '../components/FinanceTaxesTab';
import { PageHeader } from '../ui';

export function FinanceTaxesPage() {
  const { item } = findNav('finance-taxes');
  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FinanceTaxesTab />
    </>
  );
}
