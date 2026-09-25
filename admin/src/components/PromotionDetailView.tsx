import { useEffect, useState } from 'react';
import {
  activatePromotion,
  deactivatePromotion,
  deletePromotion,
  fetchPromotion,
  fetchPromotionAudience,
  fetchPromotionRedemptions,
} from '../lib/adminPromotions';
import { ApiError } from '../lib/api';
import { formatDateTime, formatSom } from '../lib/format';
import { Button, tableClass } from '../ui';
import {
  Promotion,
  PromotionAudienceCandidate,
  PromotionRedemptionItem,
  PROMOTION_BENEFIT_TYPE_LABELS,
  PROMOTION_ELIGIBILITY_REASON_LABELS,
} from '../lib/types';

interface PromotionDetailViewProps {
  promotionId: string;
  onBack: () => void;
  onEdit: (promotion: Promotion) => void;
  onDeleted: () => void;
}

function describeBenefit(promotion: Promotion): string {
  const { benefit } = promotion;
  switch (benefit.type) {
    case 'PERCENT_DISCOUNT':
      return `${benefit.value}% off`;
    case 'FIXED_DISCOUNT':
      return `${formatSom(benefit.value ?? 0)} off`;
    case 'FREE_PRODUCT':
      return `Free ${benefit.product?.name ?? 'product'} × ${benefit.quantity ?? 1}`;
    case 'LOYALTY_POINTS':
      return `+${benefit.value} loyalty points`;
    default:
      return PROMOTION_BENEFIT_TYPE_LABELS[benefit.type];
  }
}

export function PromotionDetailView({ promotionId, onBack, onEdit, onDeleted }: PromotionDetailViewProps) {
  const [promotion, setPromotion] = useState<Promotion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [showAudience, setShowAudience] = useState(false);
  const [audience, setAudience] = useState<PromotionAudienceCandidate[] | null>(null);
  const [audienceCounts, setAudienceCounts] = useState<{ segmentMatchCount: number; eligibleCount: number; ineligibleCount: number } | null>(null);
  const [audienceCursor, setAudienceCursor] = useState<string | null>(null);

  const [showRedemptions, setShowRedemptions] = useState(false);
  const [redemptions, setRedemptions] = useState<PromotionRedemptionItem[] | null>(null);
  const [redemptionsCursor, setRedemptionsCursor] = useState<string | null>(null);

  const load = () => {
    setPromotion(null);
    setError(null);
    fetchPromotion(promotionId)
      .then(setPromotion)
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load promotion.'));
  };

  useEffect(() => {
    load();
    setShowAudience(false);
    setAudience(null);
    setShowRedemptions(false);
    setRedemptions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promotionId]);

  const handleLoadAudience = () => {
    setShowAudience(true);
    setAudience(null);
    fetchPromotionAudience(promotionId)
      .then((page) => {
        setAudience(page.items);
        setAudienceCounts({ segmentMatchCount: page.segmentMatchCount, eligibleCount: page.eligibleCount, ineligibleCount: page.ineligibleCount });
        setAudienceCursor(page.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load audience.'));
  };

  const handleLoadMoreAudience = async () => {
    if (!audienceCursor) return;
    const page = await fetchPromotionAudience(promotionId, audienceCursor);
    setAudience((current) => [...(current ?? []), ...page.items]);
    setAudienceCursor(page.nextCursor);
  };

  const handleLoadRedemptions = () => {
    setShowRedemptions(true);
    setRedemptions(null);
    fetchPromotionRedemptions(promotionId)
      .then((page) => {
        setRedemptions(page.items);
        setRedemptionsCursor(page.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load redemptions.'));
  };

  const handleLoadMoreRedemptions = async () => {
    if (!redemptionsCursor) return;
    const page = await fetchPromotionRedemptions(promotionId, redemptionsCursor);
    setRedemptions((current) => [...(current ?? []), ...page.items]);
    setRedemptionsCursor(page.nextCursor);
  };

  const handleActivate = async () => {
    setIsBusy(true);
    try {
      setPromotion(await activatePromotion(promotionId));
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to activate promotion.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeactivate = async () => {
    setIsBusy(true);
    try {
      setPromotion(await deactivatePromotion(promotionId));
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to deactivate promotion.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    setIsBusy(true);
    try {
      await deletePromotion(promotionId);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to delete promotion.');
      setIsBusy(false);
    }
  };

  return (
    <div>
      <Button onClick={onBack} className="mb-4" variant="secondary">
        ← Back to promotions
      </Button>

      {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      {!promotion && !error && <p className="text-[13px] leading-snug text-muted">Loading...</p>}

      {promotion && (
        <>
          <h1>{promotion.name}</h1>
          {promotion.description && <p className="text-[13px] leading-snug text-muted">{promotion.description}</p>}

          <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Status</span>
              <span>{promotion.isActive ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Audience</span>
              <span>{promotion.segment ? promotion.segment.name : 'Everyone'}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Benefit</span>
              <span>{describeBenefit(promotion)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Starts</span>
              <span>{formatDateTime(promotion.startsAt)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Ends</span>
              <span>{promotion.endsAt ? formatDateTime(promotion.endsAt) : 'No end date'}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Usage limit per customer</span>
              <span>{promotion.usageLimitPerCustomer ?? 'Unlimited'}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Total redemptions</span>
              <span>{promotion.redemptionCount}</span>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button onClick={() => onEdit(promotion)} variant="secondary">
              Edit
            </Button>
            {promotion.isActive ? (
              <Button disabled={isBusy} onClick={handleDeactivate} variant="secondary">
                Deactivate
              </Button>
            ) : (
              <Button disabled={isBusy} onClick={handleActivate} variant="primary">
                Activate
              </Button>
            )}
            <Button onClick={handleLoadAudience} variant="secondary">
              View audience
            </Button>
            <Button onClick={handleLoadRedemptions} variant="secondary">
              View redemptions
            </Button>
            <Button disabled={isBusy} onClick={handleDelete} variant="secondary">
              {isBusy ? 'Working...' : 'Delete'}
            </Button>
          </div>

          {showAudience && (
            <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
              <h3 className="m-0">Audience</h3>
              {audienceCounts && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                    <span className="text-sm font-semibold">Matched by segment</span>
                    <span>{audienceCounts.segmentMatchCount}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                    <span className="text-sm font-semibold">Currently eligible</span>
                    <span>{audienceCounts.eligibleCount}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                    <span className="text-sm font-semibold">Not eligible</span>
                    <span>{audienceCounts.ineligibleCount}</span>
                  </div>
                </>
              )}
              {audience === null ? (
                <p className="text-[13px] leading-snug text-muted">Loading...</p>
              ) : audience.length === 0 ? (
                <p className="text-[13px] leading-snug text-muted">No matching customers.</p>
              ) : (
                <>
                  <table className={tableClass.table}>
                    <thead>
                      <tr>
                        <th className={tableClass.th}>Name</th>
                        <th className={tableClass.th}>Phone</th>
                        <th className={tableClass.th}>Eligibility</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audience.map((candidate) => (
                        <tr className={tableClass.tr} key={candidate.customerId}>
                          <td className={tableClass.td}>{candidate.displayName ?? '—'}</td>
                          <td className={tableClass.td}>{candidate.phone ?? '—'}</td>
                          <td className={tableClass.td}>{candidate.eligible ? 'Eligible' : PROMOTION_ELIGIBILITY_REASON_LABELS[candidate.reason ?? 'NOT_ELIGIBLE']}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {audienceCursor && (
                    <Button onClick={handleLoadMoreAudience} className="mt-3" variant="secondary">
                      Load more
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

          {showRedemptions && (
            <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
              <h3 className="m-0">Redemptions</h3>
              {redemptions === null ? (
                <p className="text-[13px] leading-snug text-muted">Loading...</p>
              ) : redemptions.length === 0 ? (
                <p className="text-[13px] leading-snug text-muted">No redemptions yet.</p>
              ) : (
                <>
                  <table className={tableClass.table}>
                    <thead>
                      <tr>
                        <th className={tableClass.th}>Name</th>
                        <th className={tableClass.th}>Phone</th>
                        <th className={tableClass.th}>#</th>
                        <th className={tableClass.th}>Benefit</th>
                        <th className={tableClass.th}>Redeemed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {redemptions.map((redemption, index) => (
                        <tr className={tableClass.tr} key={`${redemption.customerId}-${redemption.usageIndex}-${index}`}>
                          <td className={tableClass.td}>{redemption.displayName ?? '—'}</td>
                          <td className={tableClass.td}>{redemption.phone ?? '—'}</td>
                          <td className={tableClass.td}>{redemption.usageIndex}</td>
                          <td className={tableClass.td}>
                            {redemption.benefit.type === 'PERCENT_DISCOUNT' && `${redemption.benefit.value}%`}
                            {redemption.benefit.type === 'FIXED_DISCOUNT' && formatSom(redemption.benefit.value ?? 0)}
                            {redemption.benefit.type === 'FREE_PRODUCT' &&
                              `Free ${redemption.benefit.product?.name ?? ''} × ${redemption.benefit.quantity ?? 1}`}
                            {redemption.benefit.type === 'LOYALTY_POINTS' && `+${redemption.benefit.value} pts`}
                          </td>
                          <td className={tableClass.td}>{formatDateTime(redemption.redeemedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {redemptionsCursor && (
                    <Button onClick={handleLoadMoreRedemptions} className="mt-3" variant="secondary">
                      Load more
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
