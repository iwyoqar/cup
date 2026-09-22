import { useEffect, useState } from 'react';
import { fetchMyReferrals } from '../../lib/api/referrals';
import { getTelegramWebApp } from '../../lib/telegram/webapp';
import { ReferralOverview } from '../../types/api';
import { SectionSkeleton } from '../../app/SectionSkeleton';

type Enabled = Extract<ReferralOverview, { eligible: true }>;

const SHARE_TEXT = "CUP Coffee'ga qo'shiling — birinchi xaridingizdan keyin sovg'a ballar olasiz!";
const fmt = (n: number) => n.toLocaleString('ru-RU');

// Phase 14 — "Do'stingizni taklif qiling". Shown only while the program is on and the customer is registered; while it is off (or on any error) the
// section simply does not exist, so it can never block the account page. Sharing is ALWAYS a deliberate tap: it opens Telegram's own share dialog
// (t.me/share/url) with the customer's link, falling back to the Web Share API and then to copying the link — nothing is ever sent automatically.
export function ReferralSection() {
  const [data, setData] = useState<ReferralOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyReferrals()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null;
  if (!data) return <SectionSkeleton height={160} />;
  if (!data.enabled || !data.eligible) return null;
  return <Body data={data} copied={copied} setCopied={setCopied} />;
}

function Body({ data, copied, setCopied }: { data: Enabled; copied: 'code' | 'link' | null; setCopied: (v: 'code' | 'link' | null) => void }) {
  const copy = async (text: string, what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard can be unavailable inside some webviews — the code stays visible for manual copying.
    }
  };

  const share = async () => {
    if (!data.referralLink) return;
    const webApp = getTelegramWebApp();
    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(data.referralLink)}&text=${encodeURIComponent(SHARE_TEXT)}`);
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ text: SHARE_TEXT, url: data.referralLink });
      } catch {
        // Dismissed by the user — nothing to do.
      }
      return;
    }
    await copy(data.referralLink, 'link');
  };

  const own = data.myReferral;
  const ownText =
    own === null
      ? ''
      : own.welcomePoints !== null
        ? `Do‘stingiz taklifi uchun ${fmt(own.welcomePoints)} ball oldingiz.`
        : own.status === 'ATTRIBUTED' || own.status === 'REGISTERED'
          ? 'Siz do‘stingiz taklifi bilan keldingiz — birinchi xaridingizdan keyin sovg‘a ballar beriladi.'
          : '';
  return (
    <section className="account-section rf">
      <h2 className="section-title">Do‘stingizni taklif qiling</h2>
      <p className="hint-text">
        Do‘stingiz birinchi xaridini qilganda siz {data.reward.referrerPoints > 0 ? `${fmt(data.reward.referrerPoints)} ball` : 'bonus'}, do‘stingiz esa{' '}
        {data.reward.friendPoints > 0 ? `${fmt(data.reward.friendPoints)} ball` : 'bonus'} oladi.
      </p>

      <div className="rf-code">
        <div>
          <div className="lx-eyebrow">Sizning kodingiz</div>
          <div className="rf-code__value">{data.referralCode}</div>
        </div>
        <button className="button-secondary" onClick={() => copy(data.referralCode, 'code')} type="button">
          {copied === 'code' ? 'Nusxa olindi' : 'Nusxa olish'}
        </button>
      </div>

      <button className="button-primary" disabled={!data.referralLink} onClick={share} type="button">
        {copied === 'link' ? 'Havola nusxa olindi' : 'Do‘stni taklif qilish'}
      </button>
      {!data.referralLink && <p className="hint-text">Taklif havolasi tez orada tayyor bo‘ladi.</p>}
      {data.limitReached && <p className="hint-text">Siz taklif bonuslarining maksimal miqdoriga yetdingiz.</p>}

      <div className="lx-wallets">
        <div className="lx-tile">
          <div className="lx-eyebrow">Muvaffaqiyatli</div>
          <div className="lx-tile__value">{fmt(data.successfulReferrals)}</div>
          <div className="lx-tile__hint">taklif</div>
        </div>
        <div className="lx-tile">
          <div className="lx-eyebrow">Kutilmoqda</div>
          <div className="lx-tile__value">{fmt(data.pendingReferrals)}</div>
          <div className="lx-tile__hint">taklif</div>
        </div>
        <div className="lx-tile">
          <div className="lx-eyebrow">Olingan ballar</div>
          <div className="lx-tile__value">{fmt(data.totalRewardsEarned)}</div>
          <div className="lx-tile__hint">taklif bonuslari</div>
        </div>
      </div>

      {ownText && <p className="hint-text">{ownText}</p>}
    </section>
  );
}
