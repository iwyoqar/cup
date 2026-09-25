import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { CLOSE_REASON_LABELS, fetchReferral, ReferralDetail, SKIP_REASON_LABELS } from '../lib/adminReferrals';
import { formatDateTime, formatSom } from '../lib/format';
import { Button, cx, tableClass } from '../ui';

const message = (err: unknown) => {
  const m = err instanceof ApiError ? err.backendMessage : 'Request failed.';
  return typeof m === 'string' ? m : 'Request failed.';
};

// Referral detail: attribution, qualification, reward proof and a timeline. Read-only — there is deliberately no action that edits, qualifies or
// rewards a referral. No Telegram ids, phone numbers or internal ids are shown.
export function ReferralDetailView({ referralId, onBack }: { referralId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<ReferralDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    fetchReferral(referralId)
      .then(setDetail)
      .catch((err) => setError(message(err)));
  }, [referralId]);

  return (
    <div>
      <Button onClick={onBack} className="mb-4" variant="secondary">
        ← Back to referrals
      </Button>
      {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      {!detail && !error && <p className="text-[13px] leading-snug text-muted">Loading...</p>}
      {detail && (
        <>
          <h1>
            {detail.referrer.displayName ?? '—'} → {detail.referred.displayName ?? '—'}
          </h1>

          <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
            <h3 className="m-0">Attribution</h3>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Status</span>
              <strong>{detail.status}</strong>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Referral code used</span>
              <span>{detail.attribution.code ?? '—'}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
              <span className="text-sm font-semibold">Attributed / registered</span>
              <span>
                {formatDateTime(detail.attribution.attributedAt)} / {detail.attribution.registeredAt ? formatDateTime(detail.attribution.registeredAt) : '—'}
              </span>
            </div>
            {detail.closed && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                <span className="text-sm font-semibold">Closed</span>
                <span>
                  {formatDateTime(detail.closed.at)} — {detail.closed.reason ? (CLOSE_REASON_LABELS[detail.closed.reason] ?? detail.closed.reason) : ''}
                </span>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
            <h3 className="m-0">Qualification</h3>
            {detail.qualification.qualifiedAt ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                  <span className="text-sm font-semibold">Qualified</span>
                  <span>{formatDateTime(detail.qualification.qualifiedAt)}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
                  <span className="text-sm font-semibold">Qualifying purchase</span>
                  <span>
                    {detail.qualification.source ?? '—'}
                    {detail.qualification.amountMinor !== null ? ` · ${formatSom(detail.qualification.amountMinor)}` : ''}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-[13px] leading-snug text-muted m-0">
                Not qualified — no qualifying purchase yet.
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
            <h3 className="m-0">Rewards</h3>
            {detail.rewards.length === 0 ? (
              <p className="text-[13px] leading-snug text-muted m-0">
                No reward has been decided.
              </p>
            ) : (
              detail.rewards.map((r) => (
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0" key={r.beneficiary}>
                  <span className="text-sm font-semibold">{r.beneficiary === 'REFERRER' ? 'Referrer' : 'Invited friend'}</span>
                  <span>
                    {r.status === 'GRANTED' ? `${r.points.toLocaleString('ru-RU')} points granted` : `Skipped — ${r.skipReason ? (SKIP_REASON_LABELS[r.skipReason] ?? r.skipReason) : ''}`}
                    {' · '}
                    {formatDateTime(r.at)}
                  </span>
                </div>
              ))
            )}
          </div>

          <h3>Timeline</h3>
          <table className={tableClass.table}>
            <tbody>
              {detail.timeline.map((e, i) => (
                <tr className={tableClass.tr} key={i}>
                  <td className={cx(tableClass.td, 'whitespace-nowrap')}>{formatDateTime(e.at)}</td>
                  <td className={tableClass.td}>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
