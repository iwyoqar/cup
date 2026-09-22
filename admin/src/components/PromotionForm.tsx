import { useEffect, useState } from 'react';
import { createPromotion, PromotionInput, updatePromotion } from '../lib/adminPromotions';
import { ApiError } from '../lib/api';
import { CatalogProduct, fetchActiveProducts } from '../lib/adminCatalog';
import { fetchSegments } from '../lib/adminSegments';
import { Promotion, PromotionBenefitType, PROMOTION_BENEFIT_TYPE_LABELS, PROMOTION_BENEFIT_TYPES, Segment } from '../lib/types';

interface PromotionFormProps {
  existing?: Promotion;
  onSaved: (promotion: Promotion) => void;
  onCancel: () => void;
}

// datetime-local inputs work in local wall-clock time with no timezone/seconds
// ("2026-09-20T14:30") — converted to/from full ISO strings at the boundary. The server is the
// only authority on "now" (spec: "use server time, do not trust client time") — these
// conversions only affect what's displayed/submitted, never how eligibility is evaluated.
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}

export function PromotionForm({ existing, onSaved, onCancel }: PromotionFormProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [segmentId, setSegmentId] = useState(existing?.segment?.id ?? '');
  const [benefitType, setBenefitType] = useState<PromotionBenefitType>(existing?.benefit.type ?? 'PERCENT_DISCOUNT');
  const [benefitValue, setBenefitValue] = useState(existing?.benefit.value?.toString() ?? '');
  const [benefitProductId, setBenefitProductId] = useState(existing?.benefit.product?.id ?? '');
  const [benefitQuantity, setBenefitQuantity] = useState(existing?.benefit.quantity?.toString() ?? '1');
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(existing?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toDatetimeLocal(existing?.endsAt ?? null));
  const [usageLimit, setUsageLimit] = useState(existing?.usageLimitPerCustomer?.toString() ?? '');
  const [isActive, setIsActive] = useState(existing?.isActive ?? false);

  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const benefitLocked = existing?.hasRedemptions ?? false;

  useEffect(() => {
    fetchSegments()
      .then((page) => setSegments(page.items.filter((s) => s.isActive)))
      .catch(() => setSegments([]));
    fetchActiveProducts()
      .then(setProducts)
      .catch(() => setProducts([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (name.trim().length === 0) {
      setError('Name is required.');
      return;
    }
    if (!startsAt) {
      setError('Start date is required.');
      return;
    }

    const input: PromotionInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      segmentId: segmentId || null,
      benefitType,
      startsAt: fromDatetimeLocal(startsAt)!,
      endsAt: fromDatetimeLocal(endsAt),
      usageLimitPerCustomer: usageLimit ? Number(usageLimit) : null,
      isActive,
    };

    if (!benefitLocked) {
      if (benefitType === 'PERCENT_DISCOUNT' || benefitType === 'FIXED_DISCOUNT' || benefitType === 'LOYALTY_POINTS') {
        input.benefitValue = benefitValue ? Number(benefitValue) : null;
      }
      if (benefitType === 'FREE_PRODUCT') {
        input.benefitProductId = benefitProductId || null;
        input.benefitQuantity = benefitQuantity ? Number(benefitQuantity) : null;
      }
    }

    setIsSaving(true);
    try {
      const saved = existing ? await updatePromotion(existing.id, input) : await createPromotion(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to save promotion.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>{existing ? 'Edit promotion' : 'Create promotion'}</h1>

      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="promo-name">Name</label>
        <input id="promo-name" onChange={(e) => setName(e.target.value)} type="text" value={name} />
      </div>

      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="promo-description">Description</label>
        <input id="promo-description" onChange={(e) => setDescription(e.target.value)} type="text" value={description} />
      </div>

      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="promo-segment">Audience segment (optional — leave blank for everyone)</label>
        {segments === null ? (
          <p className="hint-text">Loading segments...</p>
        ) : (
          <select id="promo-segment" onChange={(e) => setSegmentId(e.target.value)} value={segmentId}>
            <option value="">Everyone</option>
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <h3>Benefit</h3>
      {benefitLocked && (
        <p className="hint-text">
          This promotion has existing redemptions — its benefit type/value/product/quantity can no longer be changed.
        </p>
      )}

      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="promo-benefit-type">Type</label>
        <select
          disabled={benefitLocked}
          id="promo-benefit-type"
          onChange={(e) => setBenefitType(e.target.value as PromotionBenefitType)}
          value={benefitType}
        >
          {PROMOTION_BENEFIT_TYPES.map((type) => (
            <option key={type} value={type}>
              {PROMOTION_BENEFIT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      {benefitType === 'PERCENT_DISCOUNT' && (
        <div className="field" style={{ maxWidth: 200 }}>
          <label htmlFor="promo-benefit-value">Percentage (1-100)</label>
          <input
            disabled={benefitLocked}
            id="promo-benefit-value"
            max={100}
            min={1}
            onChange={(e) => setBenefitValue(e.target.value)}
            type="number"
            value={benefitValue}
          />
        </div>
      )}

      {benefitType === 'FIXED_DISCOUNT' && (
        <div className="field" style={{ maxWidth: 200 }}>
          <label htmlFor="promo-benefit-value">Summa (so'm)</label>
          <input
            disabled={benefitLocked}
            id="promo-benefit-value"
            min={1}
            onChange={(e) => setBenefitValue(e.target.value)}
            type="number"
            value={benefitValue}
          />
        </div>
      )}

      {benefitType === 'FREE_PRODUCT' && (
        <>
          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="promo-benefit-product">Product</label>
            {products === null ? (
              <p className="hint-text">Loading products...</p>
            ) : (
              <select disabled={benefitLocked} id="promo-benefit-product" onChange={(e) => setBenefitProductId(e.target.value)} value={benefitProductId}>
                <option value="">Select a product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="field" style={{ maxWidth: 200 }}>
            <label htmlFor="promo-benefit-quantity">Quantity</label>
            <input
              disabled={benefitLocked}
              id="promo-benefit-quantity"
              min={1}
              onChange={(e) => setBenefitQuantity(e.target.value)}
              type="number"
              value={benefitQuantity}
            />
          </div>
        </>
      )}

      {benefitType === 'LOYALTY_POINTS' && (
        <div className="field" style={{ maxWidth: 200 }}>
          <label htmlFor="promo-benefit-value">Points</label>
          <input
            disabled={benefitLocked}
            id="promo-benefit-value"
            min={1}
            onChange={(e) => setBenefitValue(e.target.value)}
            type="number"
            value={benefitValue}
          />
        </div>
      )}

      <h3>Validity</h3>
      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="promo-starts-at">Starts at</label>
        <input id="promo-starts-at" onChange={(e) => setStartsAt(e.target.value)} type="datetime-local" value={startsAt} />
      </div>
      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="promo-ends-at">Ends at (optional)</label>
        <input id="promo-ends-at" onChange={(e) => setEndsAt(e.target.value)} type="datetime-local" value={endsAt} />
      </div>

      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="promo-usage-limit">Usage limit per customer (blank = unlimited)</label>
        <input id="promo-usage-limit" min={1} onChange={(e) => setUsageLimit(e.target.value)} type="number" value={usageLimit} />
      </div>

      <div className="settings-row" style={{ maxWidth: 320, marginTop: 12 }}>
        <span className="settings-row__label">Active</span>
        <label className="toggle">
          <input checked={isActive} onChange={(e) => setIsActive(e.target.checked)} type="checkbox" />
          <span className="toggle__track" />
        </label>
      </div>

      {error && (
        <p className="error-text" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}

      <div className="settings-footer">
        <button className="button-primary" disabled={isSaving} type="submit">
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button className="button-secondary" disabled={isSaving} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}
