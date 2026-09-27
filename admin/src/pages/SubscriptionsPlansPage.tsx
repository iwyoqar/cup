import { useEffect, useState } from 'react';
import { CatalogProduct, fetchActiveProducts } from '../lib/adminCatalog';
import { EligibleProduct, errorText, PlanFormBody, SubPlan, SubProductMapping, subscriptionsApi, useSubscriptionsGet } from '../lib/adminSubscriptions';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { Button, Column, DataTable, EmptyState, FilterField, Input, Modal, PageHeader, SectionCard, Select, StatusBadge, Toggle, useToast } from '../ui';
import { num, ReportBody } from './reportsShared';

type PlanForm = PlanFormBody;
const EMPTY: PlanForm = { name: '', description: null, priceMinor: 0, durationDays: 30, totalPortions: 30, dailyPortionLimit: 3, cooldownMinutes: 60, isActive: true, productId: null };

// Plans + the drinks a subscription covers. Editing a plan changes FUTURE purchases only: each existing subscription keeps the terms it was
// bought with. Drink eligibility is an explicit product → portions mapping (never guessed from product names): hot and iced, standard and
// double are separate products and each must be added here.
export function SubscriptionsPlansPage() {
  const toast = useToast();
  const { item } = findNav('subscriptions-plans');
  const plans = useSubscriptionsGet<SubPlan[]>('/plans');
  const mappings = useSubscriptionsGet<SubProductMapping[]>('/products');
  const [editing, setEditing] = useState<{ id: string | null; form: PlanForm } | null>(null);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [newProduct, setNewProduct] = useState('');
  const [newCost, setNewCost] = useState(1);
  const eligibleProducts = useSubscriptionsGet<EligibleProduct[]>('/eligible-products');

  useEffect(() => {
    fetchActiveProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  const savePlan = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const body = { ...editing.form, description: editing.form.description?.trim() ? editing.form.description.trim() : null };
      if (editing.id) await subscriptionsApi.updatePlan(editing.id, body);
      else await subscriptionsApi.createPlan(body);
      toast({ tone: 'success', title: editing.id ? 'Plan updated' : 'Plan created' });
      setEditing(null);
      plans.reload();
    } catch (err) {
      toast({ tone: 'error', title: 'Could not save the plan', text: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  const mappingAction = async (fn: () => Promise<unknown>, title: string) => {
    try {
      await fn();
      toast({ tone: 'success', title });
      mappings.reload();
    } catch (err) {
      toast({ tone: 'error', title: 'Could not update drinks', text: errorText(err) });
    }
  };

  const planColumns: Column<SubPlan>[] = [
    { key: 'n', header: 'Plan', cell: (p) => <span className="font-semibold text-black">{p.name}</span> },
    { key: 'pr', header: 'Price', numeric: true, cell: (p) => formatSom(p.priceMinor) },
    { key: 'd', header: 'Days', numeric: true, cell: (p) => num(p.durationDays) },
    { key: 'po', header: 'Portions', numeric: true, cell: (p) => num(p.totalPortions) },
    { key: 'l', header: 'Daily limit', numeric: true, cell: (p) => num(p.dailyPortionLimit) },
    { key: 'c', header: 'Cooldown', numeric: true, cell: (p) => `${num(p.cooldownMinutes)} min` },
    {
      key: 'pp',
      header: 'Poster Product',
      low: true,
      cell: (p) =>
        p.posterProduct ? (
          <span className="flex flex-col">
            <span className="font-semibold text-black">{p.posterProduct.name}</span>
            <span className="text-xs text-muted">
              Poster #{p.posterProduct.posterProductId}
              {p.posterProduct.isActive ? '' : ' · inactive'}
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted">Not mapped — no real Poster order purchase</span>
        ),
    },
    { key: 's', header: 'Status', cell: (p) => <StatusBadge tone={p.isActive ? 'ok' : 'neutral'}>{p.isActive ? 'active' : 'inactive'}</StatusBadge> },
    {
      key: 'a',
      header: '',
      actions: true,
      cell: (p) => (
        <Button onClick={() => setEditing({ id: p.id, form: { name: p.name, description: p.description, priceMinor: p.priceMinor, durationDays: p.durationDays, totalPortions: p.totalPortions, dailyPortionLimit: p.dailyPortionLimit, cooldownMinutes: p.cooldownMinutes, isActive: p.isActive, productId: p.posterProduct?.productId ?? null } })} size="sm" variant="secondary">
          Edit
        </Button>
      ),
    },
  ];

  const mappingColumns: Column<SubProductMapping>[] = [
    { key: 'n', header: 'Drink (CUP / Poster product)', cell: (m) => <span className="flex flex-col"><span className="font-semibold text-black">{m.productName}</span><span className="text-xs text-muted">Poster #{m.posterProductId} · {m.categoryName}{m.productActive ? '' : ' · product inactive'}</span></span> },
    {
      key: 'p',
      header: 'Portions',
      cell: (m) => (
        <Select aria-label={`Portions for ${m.productName}`} onChange={(e) => void mappingAction(() => subscriptionsApi.updateProduct(m.id, { portionCost: Number(e.target.value) }), 'Portions updated')} value={m.portionCost}>
          <option value={1}>1 — standard</option>
          <option value={2}>2 — double</option>
          <option value={3}>3</option>
        </Select>
      ),
    },
    { key: 'c', header: 'Theoretical cost', numeric: true, low: true, cell: (m) => (m.theoreticalCostMinor === null ? 'no recipe' : formatSom(m.theoreticalCostMinor)) },
    { key: 'u', header: 'Usable', cell: (m) => <StatusBadge tone={m.usable ? 'ok' : 'neutral'}>{m.usable ? 'yes' : 'no'}</StatusBadge> },
    { key: 'a', header: 'Active', actions: true, cell: (m) => <Toggle checked={m.isActive} label={`${m.productName} active`} onChange={(v) => void mappingAction(() => subscriptionsApi.updateProduct(m.id, { isActive: v }), v ? 'Drink enabled' : 'Drink disabled')} /> },
  ];

  const mapped = new Set((mappings.data ?? []).map((m) => m.productId));
  const f = editing?.form;
  const set = (patch: Partial<PlanForm>) => editing && setEditing({ ...editing, form: { ...editing.form, ...patch } });
  const numField = (label: string, key: keyof PlanForm, suffix = '') => (
    <FilterField label={label + suffix}>
      <Input min={0} onChange={(e) => set({ [key]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) } as Partial<PlanForm>)} type="number" value={String(f?.[key] ?? '')} />
    </FilterField>
  );
  const selectedPosterProduct = f?.productId ? (eligibleProducts.data ?? []).find((p) => p.id === f.productId) : null;
  const priceMismatch = f && selectedPosterProduct && selectedPosterProduct.priceMinor !== f.priceMinor;

  return (
    <>
      <PageHeader
        actions={
          <Button onClick={() => setEditing({ id: null, form: EMPTY })} variant="primary">
            New plan
          </Button>
        }
        description={item.description}
        title={item.label}
      />
      <ReportBody data={plans.data} error={plans.error} loading={plans.loading} ready reload={plans.reload} title="Plans could not be loaded">
        {(rows) => (
          <SectionCard description="Changes apply to new purchases; existing subscriptions keep the terms they were bought with." flush title="Plans">
            <DataTable columns={planColumns} empty={<EmptyState text="No plan yet." title="Nothing here" variant="inline" />} rowKey={(p) => p.id} rows={rows} />
          </SectionCard>
        )}
      </ReportBody>

      <SectionCard className="mt-5" description="Only drinks listed here can be taken on a subscription. Standard = 1 portion, double = 2. Hot and iced are separate products." title="Eligible drinks">
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <FilterField label="Product">
            <Select onChange={(e) => setNewProduct(e.target.value)} value={newProduct}>
              <option value="">Choose a product…</option>
              {products
                .filter((p) => !mapped.has(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </FilterField>
          <FilterField label="Portions">
            <Select onChange={(e) => setNewCost(Number(e.target.value))} value={newCost}>
              <option value={1}>1 — standard</option>
              <option value={2}>2 — double</option>
              <option value={3}>3</option>
            </Select>
          </FilterField>
          <Button
            disabled={!newProduct}
            onClick={() =>
              void mappingAction(async () => {
                await subscriptionsApi.addProduct(newProduct, newCost);
                setNewProduct('');
              }, 'Drink added')
            }
            variant="secondary"
          >
            Add drink
          </Button>
        </div>
        {mappings.error ? (
          <p className="text-sm text-err">{mappings.error}</p>
        ) : (
          <DataTable columns={mappingColumns} empty={<EmptyState text="No drink is eligible yet — subscriptions cannot be redeemed until at least one is added." title="No eligible drinks" variant="inline" />} rowKey={(m) => m.id} rows={mappings.data ?? []} />
        )}
      </SectionCard>

      {editing && f && (
        <Modal
          footer={
            <>
              <Button disabled={saving} onClick={() => setEditing(null)} variant="secondary">
                Cancel
              </Button>
              <Button disabled={saving || !f.name.trim() || f.priceMinor < 1 || f.durationDays < 1 || f.totalPortions < 1 || f.dailyPortionLimit < 1 || !!priceMismatch} loading={saving} onClick={() => void savePlan()} variant="primary">
                Save
              </Button>
            </>
          }
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit plan' : 'New plan'}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FilterField label="Name">
              <Input onChange={(e) => set({ name: e.target.value })} value={f.name} />
            </FilterField>
            {numField('Price', 'priceMinor', " (so'm)")}
            {numField('Duration', 'durationDays', ' (days)')}
            {numField('Total portions', 'totalPortions')}
            {numField('Daily portion limit', 'dailyPortionLimit')}
            {numField('Cooldown', 'cooldownMinutes', ' (minutes)')}
            <label className="flex items-center gap-3 text-sm font-semibold">
              <Toggle checked={f.isActive} label="Plan active" onChange={(v) => set({ isActive: v })} />
              Available for purchase
            </label>
            <FilterField label="Poster mahsulot">
              <Select onChange={(e) => set({ productId: e.target.value || null })} value={f.productId ?? ''}>
                <option value="">Not mapped — no real Poster order purchase</option>
                {(eligibleProducts.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatSom(p.priceMinor)} (Poster #{p.posterProductId})
                  </option>
                ))}
              </Select>
            </FilterField>
          </div>
          {selectedPosterProduct && (
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <span className="text-muted">Subscription narxi</span>
              <span className="font-semibold text-black">{formatSom(f.priceMinor)}</span>
              <span className="text-muted">Poster product narxi</span>
              <span className="font-semibold text-black">{formatSom(selectedPosterProduct.priceMinor)}</span>
            </div>
          )}
          {priceMismatch && <p className="mt-2 text-sm font-semibold text-err">Subscription narxi va Poster product narxi mos emas. Saqlashdan oldin birini to‘g‘rilang.</p>}
        </Modal>
      )}
    </>
  );
}
