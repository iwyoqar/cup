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
import { Button, tableClass } from '../ui';

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
      <Button onClick={onBack} className="mb-4" variant="secondary">
        ← Back to reward programs
      </Button>

      {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      {!program && !error && <p className="text-[13px] leading-snug text-muted">Loading...</p>}

      {program && (
        <>
          <h1>{program.name}</h1>
          {program.description && <p className="text-[13px] leading-snug text-muted">{program.description}</p>}

          <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Status</span>
              <span>{program.isActive ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Rule</span>
              <span>
                Buy {program.buyQuantity}, get {program.rewardQuantity} free — {program.qualifyingCategory.name}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Starts</span>
              <span>{formatDateTime(program.startsAt)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Ends</span>
              <span>{program.endsAt ? formatDateTime(program.endsAt) : 'No end date'}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Total redemptions</span>
              <span>{program.redemptionCount}</span>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button onClick={() => onEdit(program)} variant="secondary">
              Edit
            </Button>
            {program.isActive ? (
              <Button disabled={isBusy} onClick={handleDeactivate} variant="secondary">
                Deactivate
              </Button>
            ) : (
              <Button disabled={isBusy} onClick={handleActivate} variant="primary">
                Activate
              </Button>
            )}
            <Button onClick={handleLoadRedemptions} variant="secondary">
              View redemptions
            </Button>
            <Button disabled={isBusy} onClick={handleDelete} variant="secondary">
              {isBusy ? 'Working...' : 'Delete'}
            </Button>
          </div>

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
                        <th className={tableClass.th}>Reward product</th>
                        <th className={tableClass.th}>Redeemed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {redemptions.map((redemption, index) => (
                        <tr className={tableClass.tr} key={`${redemption.customerId}-${redemption.redemptionIndex}-${index}`}>
                          <td className={tableClass.td}>{redemption.displayName ?? '—'}</td>
                          <td className={tableClass.td}>{redemption.phone ?? '—'}</td>
                          <td className={tableClass.td}>{redemption.redemptionIndex}</td>
                          <td className={tableClass.td}>
                            {redemption.rewardProduct?.name ?? '—'} × {redemption.rewardQuantity}
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
