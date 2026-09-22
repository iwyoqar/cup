import { useEffect, useState } from 'react';
import {
  activateRewardProgram,
  deactivateRewardProgram,
  deleteRewardProgram,
  fetchRewardProgram,
  fetchRewardRedemptions,
} from '../lib/adminRewardPrograms';
import { ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { RewardProgram, RewardRedemptionItem } from '../lib/types';

interface RewardProgramDetailViewProps {
  programId: string;
  onBack: () => void;
  onEdit: (program: RewardProgram) => void;
  onDeleted: () => void;
}

export function RewardProgramDetailView({ programId, onBack, onEdit, onDeleted }: RewardProgramDetailViewProps) {
  const [program, setProgram] = useState<RewardProgram | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [showRedemptions, setShowRedemptions] = useState(false);
  const [redemptions, setRedemptions] = useState<RewardRedemptionItem[] | null>(null);
  const [redemptionsCursor, setRedemptionsCursor] = useState<string | null>(null);

  const load = () => {
    setProgram(null);
    setError(null);
    fetchRewardProgram(programId)
      .then(setProgram)
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load reward program.'));
  };

  useEffect(() => {
    load();
    setShowRedemptions(false);
    setRedemptions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId]);

  const handleLoadRedemptions = () => {
    setShowRedemptions(true);
    setRedemptions(null);
    fetchRewardRedemptions(programId)
      .then((page) => {
        setRedemptions(page.items);
        setRedemptionsCursor(page.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load redemptions.'));
  };

  const handleLoadMoreRedemptions = async () => {
    if (!redemptionsCursor) return;
    const page = await fetchRewardRedemptions(programId, redemptionsCursor);
    setRedemptions((current) => [...(current ?? []), ...page.items]);
    setRedemptionsCursor(page.nextCursor);
  };

  const handleActivate = async () => {
    setIsBusy(true);
    try {
      setProgram(await activateRewardProgram(programId));
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to activate.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeactivate = async () => {
    setIsBusy(true);
    try {
      setProgram(await deactivateRewardProgram(programId));
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to deactivate.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    setIsBusy(true);
    try {
      await deleteRewardProgram(programId);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to delete.');
      setIsBusy(false);
    }
  };

  return (
    <div>
      <button className="button-secondary" onClick={onBack} style={{ marginBottom: 16 }} type="button">
        ← Back to reward programs
      </button>

      {error && <p className="error-text">{error}</p>}
      {!program && !error && <p className="hint-text">Loading...</p>}

      {program && (
        <>
          <h1>{program.name}</h1>
          {program.description && <p className="hint-text">{program.description}</p>}

          <div className="settings-card">
            <div className="settings-row">
              <span className="settings-row__label">Status</span>
              <span>{program.isActive ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Rule</span>
              <span>
                Buy {program.buyQuantity}, get {program.rewardQuantity} free — {program.qualifyingCategory.name}
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Starts</span>
              <span>{formatDateTime(program.startsAt)}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Ends</span>
              <span>{program.endsAt ? formatDateTime(program.endsAt) : 'No end date'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Total redemptions</span>
              <span>{program.redemptionCount}</span>
            </div>
          </div>

          <div className="settings-footer">
            <button className="button-secondary" onClick={() => onEdit(program)} type="button">
              Edit
            </button>
            {program.isActive ? (
              <button className="button-secondary" disabled={isBusy} onClick={handleDeactivate} type="button">
                Deactivate
              </button>
            ) : (
              <button className="button-primary" disabled={isBusy} onClick={handleActivate} type="button">
                Activate
              </button>
            )}
            <button className="button-secondary" onClick={handleLoadRedemptions} type="button">
              View redemptions
            </button>
            <button className="button-secondary" disabled={isBusy} onClick={handleDelete} type="button">
              {isBusy ? 'Working...' : 'Delete'}
            </button>
          </div>

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
                        <th>Reward product</th>
                        <th>Redeemed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {redemptions.map((redemption, index) => (
                        <tr key={`${redemption.customerId}-${redemption.redemptionIndex}-${index}`}>
                          <td>{redemption.displayName ?? '—'}</td>
                          <td>{redemption.phone ?? '—'}</td>
                          <td>{redemption.redemptionIndex}</td>
                          <td>
                            {redemption.rewardProduct?.name ?? '—'} × {redemption.rewardQuantity}
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
