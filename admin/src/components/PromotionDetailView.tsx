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
      <button className="button-secondary" onClick={onBack} style={{ marginBottom: 16 }} type="button">
        ← Back to promotions
      </button>

      {error && <p className="error-text">{error}</p>}
      {!promotion && !error && <p className="hint-text">Loading...</p>}

      {promotion && (
        <>
          <h1>{promotion.name}</h1>
          {promotion.description && <p className="hint-text">{promotion.description}</p>}

          <div className="settings-card">
            <div className="settings-row">
              <span className="settings-row__label">Status</span>
              <span>{promotion.isActive ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Audience</span>
              <span>{promotion.segment ? promotion.segment.name : 'Everyone'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Benefit</span>
              <span>{describeBenefit(promotion)}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Starts</span>
              <span>{formatDateTime(promotion.startsAt)}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Ends</span>
              <span>{promotion.endsAt ? formatDateTime(promotion.endsAt) : 'No end date'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Usage limit per customer</span>
              <span>{promotion.usageLimitPerCustomer ?? 'Unlimited'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Total redemptions</span>
              <span>{promotion.redemptionCount}</span>
            </div>
          </div>

          <div className="settings-footer">
            <button className="button-secondary" onClick={() => onEdit(promotion)} type="button">
              Edit
            </button>
            {promotion.isActive ? (
              <button className="button-secondary" disabled={isBusy} onClick={handleDeactivate} type="button">
                Deactivate
              </button>
            ) : (
              <button className="button-primary" disabled={isBusy} onClick={handleActivate} type="button">
                Activate
              </button>
            )}
            <button className="button-secondary" onClick={handleLoadAudience} type="button">
              View audience
            </button>
            <button className="button-secondary" onClick={handleLoadRedemptions} type="button">
              View redemptions
            </button>
            <button className="button-secondary" disabled={isBusy} onClick={handleDelete} type="button">
              {isBusy ? 'Working...' : 'Delete'}
            </button>
          </div>

          {showAudience && (
            <div className="settings-card">
              <h3 style={{ margin: 0 }}>Audience</h3>
              {audienceCounts && (
                <>
                  <div className="settings-row">
                    <span className="settings-row__label">Matched by segment</span>
                    <span>{audienceCounts.segmentMatchCount}</span>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row__label">Currently eligible</span>
                    <span>{audienceCounts.eligibleCount}</span>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row__label">Not eligible</span>
                    <span>{audienceCounts.ineligibleCount}</span>
                  </div>
                </>
              )}
              {audience === null ? (
                <p className="hint-text">Loading...</p>
              ) : audience.length === 0 ? (
                <p className="hint-text">No matching customers.</p>
              ) : (
                <>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Phone</th>
                        <th>Eligibility</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audience.map((candidate) => (
                        <tr key={candidate.customerId}>
                          <td>{candidate.displayName ?? '—'}</td>
                          <td>{candidate.phone ?? '—'}</td>
                          <td>{candidate.eligible ? 'Eligible' : PROMOTION_ELIGIBILITY_REASON_LABELS[candidate.reason ?? 'NOT_ELIGIBLE']}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {audienceCursor && (
                    <button className="button-secondary" onClick={handleLoadMoreAudience} style={{ marginTop: 12 }} type="button">
                      Load more
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {showRedemptions && (
            <div className="settings-card">
              <h3 style={{ margin: 0 }}>Redemptions</h3>
              {redemptions === null ? (
                <p className="hint-text">Loading...</p>
              ) : redemptions.length === 0 ? (
                <p className="hint-text">No redemptions yet.</p>
              ) : (
                <>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Phone</th>
                        <th>#</th>
                        <th>Benefit</th>
                        <th>Redeemed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {redemptions.map((redemption, index) => (
                        <tr key={`${redemption.customerId}-${redemption.usageIndex}-${index}`}>
                          <td>{redemption.displayName ?? '—'}</td>
                          <td>{redemption.phone ?? '—'}</td>
                          <td>{redemption.usageIndex}</td>
                          <td>
                            {redemption.benefit.type === 'PERCENT_DISCOUNT' && `${redemption.benefit.value}%`}
                            {redemption.benefit.type === 'FIXED_DISCOUNT' && formatSom(redemption.benefit.value ?? 0)}
                            {redemption.benefit.type === 'FREE_PRODUCT' &&
                              `Free ${redemption.benefit.product?.name ?? ''} × ${redemption.benefit.quantity ?? 1}`}
                            {redemption.benefit.type === 'LOYALTY_POINTS' && `+${redemption.benefit.value} pts`}
                          </td>
                          <td>{formatDateTime(redemption.redeemedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {redemptionsCursor && (
                    <button className="button-secondary" onClick={handleLoadMoreRedemptions} style={{ marginTop: 12 }} type="button">
                      Load more
                    </button>
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
