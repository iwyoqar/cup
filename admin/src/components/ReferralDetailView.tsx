import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { CLOSE_REASON_LABELS, fetchReferral, ReferralDetail, SKIP_REASON_LABELS } from '../lib/adminReferrals';
import { formatDateTime, formatSom } from '../lib/format';

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
      <button className="button-secondary" onClick={onBack} type="button" style={{ marginBottom: 16 }}>
        ← Back to referrals
      </button>
      {error && <p className="error-text">{error}</p>}
      {!detail && !error && <p className="hint-text">Loading...</p>}
      {detail && (
        <>
          <h1>
            {detail.referrer.displayName ?? '—'} → {detail.referred.displayName ?? '—'}
          </h1>

          <div className="settings-card">
            <h3 style={{ margin: 0 }}>Attribution</h3>
            <div className="settings-row">
              <span className="settings-row__label">Status</span>
              <strong>{detail.status}</strong>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Referral code used</span>
              <span>{detail.attribution.code ?? '—'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Attributed / registered</span>
              <span>
                {formatDateTime(detail.attribution.attributedAt)} / {detail.attribution.registeredAt ? formatDateTime(detail.attribution.registeredAt) : '—'}
              </span>
            </div>
            {detail.closed && (
              <div className="settings-row">
                <span className="settings-row__label">Closed</span>
                <span>
                  {formatDateTime(detail.closed.at)} — {detail.closed.reason ? (CLOSE_REASON_LABELS[detail.closed.reason] ?? detail.closed.reason) : ''}
                </span>
              </div>
            )}
          </div>

          <div className="settings-card">
            <h3 style={{ margin: 0 }}>Qualification</h3>
            {detail.qualification.qualifiedAt ? (
              <>
                <div className="settings-row">
                  <span className="settings-row__label">Qualified</span>
                  <span>{formatDateTime(detail.qualification.qualifiedAt)}</span>
                </div>
                <div className="settings-row">
                  <span className="settings-row__label">Qualifying purchase</span>
                  <span>
                    {detail.qualification.source ?? '—'}
                    {detail.qualification.amountMinor !== null ? ` · ${formatSom(detail.qualification.amountMinor)}` : ''}
                  </span>
                </div>
              </>
            ) : (
              <p className="hint-text" style={{ margin: 0 }}>
                Not qualified — no qualifying purchase yet.
              </p>
            )}
          </div>

          <div className="settings-card">
            <h3 style={{ margin: 0 }}>Rewards</h3>
            {detail.rewards.length === 0 ? (
              <p className="hint-text" style={{ margin: 0 }}>
                No reward has been decided.
              </p>
            ) : (
              detail.rewards.map((r) => (
                <div className="settings-row" key={r.beneficiary}>
                  <span className="settings-row__label">{r.beneficiary === 'REFERRER' ? 'Referrer' : 'Invited friend'}</span>
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
          <table className="data-table" style={{ marginTop: 0 }}>
            <tbody>
              {detail.timeline.map((e, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.at)}</td>
                  <td>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
