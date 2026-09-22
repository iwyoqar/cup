import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../../app/EmptyState';
import { SectionSkeleton } from '../../app/SectionSkeleton';
import { toUserMessage } from '../../lib/api/errors';
import { fetchMyLoyaltyHistory, fetchMyLoyaltyOverview, setMyBirthday } from '../../lib/api/loyalty';
import { formatDateTime, formatSom } from '../../lib/format';
import { LoyaltyHistoryItem, LoyaltyOverview, LoyaltyOverviewEnabled } from '../../types/api';
import { LoyaltySection } from './LoyaltySection';

interface LoyaltyHubProps {
  onOpenTransactions: () => void;
}

const HISTORY_ICON: Record<LoyaltyHistoryItem['type'], string> = {
  POINT_EARN: '＋',
  POINT_SPEND: '－',
  CASHBACK_EARN: '%',
  LEVEL_UP: '↑',
  ACHIEVEMENT: '★',
  REWARD_REDEEM: '☕',
};

const HISTORY_TITLE: Record<LoyaltyHistoryItem['type'], string> = {
  POINT_EARN: 'Ball qo‘shildi',
  POINT_SPEND: 'Ball ishlatildi',
  CASHBACK_EARN: 'Keshbek',
  LEVEL_UP: 'Yangi daraja',
  ACHIEVEMENT: 'Yutuq ochildi',
  REWARD_REDEEM: 'Bonus olindi',
};

// Phase 12 — the customer's loyalty home. When Loyalty 2.0 is switched on (GET /loyalty/overview reports enabled) it shows the
// premium view: level, XP progress, wallets, streak, achievements, birthday and history. When it is off it falls back to the
// EXISTING points section unchanged. Every number comes from the server; nothing is calculated here except drawing bars.
export function LoyaltyHub({ onOpenTransactions }: LoyaltyHubProps) {
  const [overview, setOverview] = useState<LoyaltyOverview | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setFailed(false);
    fetchMyLoyaltyOverview()
      .then((result) => {
        if (!cancelled) setOverview(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  if (failed) {
    // Never blocks the account page: show the existing section (or its own friendly message).
    return <LoyaltySection onOpenTransactions={onOpenTransactions} />;
  }
  if (!overview) return <SectionSkeleton height={220} />;
  if (!overview.enabled) return <LoyaltySection onOpenTransactions={onOpenTransactions} />;
  return <Premium data={overview} onOpenTransactions={onOpenTransactions} onBirthdaySaved={load} />;
}

function Premium({ data, onOpenTransactions, onBirthdaySaved }: { data: LoyaltyOverviewEnabled; onOpenTransactions: () => void; onBirthdaySaved: () => void }) {
  const { level, nextLevel, xp } = data;
  const span = xp.nextLevelXP !== null ? Math.max(1, xp.nextLevelXP - xp.levelStartXP) : null;
  const barWidth = span === null ? 100 : Math.min(100, (xp.levelXP / span) * 100);

  return (
    <section className="account-section lx">
      <h2 className="section-title">Sodiqlik</h2>

      {level && (
        <div className="lx-level" style={{ ['--lx-color' as string]: level.color }}>
          <div className="lx-level__top">
            <span className="lx-level__icon" aria-hidden="true">{level.icon}</span>
            <div>
              <div className="lx-eyebrow">Daraja</div>
              <div className="lx-level__name">{level.name}</div>
            </div>
            {data.cashback.enabled && level.cashbackRateBps > 0 && <span className="lx-chip">{(level.cashbackRateBps / 100).toLocaleString('ru-RU')}% keshbek</span>}
          </div>
          <div className="lx-bar" role="img" aria-label={`XP ${xp.levelXP}`}>
            <span style={{ width: `${barWidth}%` }} />
          </div>
          <div className="lx-level__meta">
            <span>{xp.lifetimeXP.toLocaleString('ru-RU')} XP</span>
            {nextLevel ? (
              <span>
                {nextLevel.name} gacha {formatSom(nextLevel.spendToNext)}
              </span>
            ) : (
              <span>Eng yuqori daraja</span>
            )}
          </div>
        </div>
      )}

      <div className="lx-wallets">
        <div className="lx-tile">
          <div className="lx-eyebrow">Ballar</div>
          <div className="lx-tile__value">{data.points.balance.toLocaleString('ru-RU')}</div>
          <div className="lx-tile__hint">jami {data.points.lifetimeEarned.toLocaleString('ru-RU')}</div>
        </div>
        {data.cashback.enabled && (
          <div className="lx-tile">
            <div className="lx-eyebrow">Keshbek</div>
            <div className="lx-tile__value">{formatSom(data.cashback.balance)}</div>
            <div className="lx-tile__hint">jami {formatSom(data.cashback.lifetimeEarned)}</div>
          </div>
        )}
      </div>

      {data.streak.enabled && (
        <div className="lx-streak">
          <span className="lx-streak__flame" aria-hidden="true">🔥</span>
          <div>
            <div className="lx-streak__value">{data.streak.current} kun ketma-ket</div>
            <div className="lx-tile__hint">Eng yaxshi natija: {data.streak.best} kun</div>
          </div>
        </div>
      )}

      {data.birthday.enabled && <Birthday birthday={data.birthday} onSaved={onBirthdaySaved} />}

      <div>
        <h3 className="lx-subtitle">Yutuqlar</h3>
        {data.achievements.length === 0 ? (
          <EmptyState variant="inline" title="Yutuqlar hali mavjud emas" />
        ) : (
          <div className="lx-achievements">
            {data.achievements.map((a) => (
              <div className={`lx-ach${a.unlocked ? ' lx-ach--on' : ''}`} key={a.code}>
                <span className="lx-ach__icon" aria-hidden="true">{a.icon}</span>
                <div className="lx-ach__name">{a.name}</div>
                <div className="lx-tile__hint">{a.unlocked ? 'Ochilgan' : `${a.progress.current} / ${a.progress.target}`}</div>
                {!a.unlocked && (
                  <div className="lx-bar lx-bar--thin" aria-hidden="true">
                    <span style={{ width: `${a.progress.target > 0 ? Math.min(100, (a.progress.current / a.progress.target) * 100) : 0}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <History />

      <button className="button-secondary" onClick={onOpenTransactions} type="button">
        Ballar tarixi
      </button>
    </section>
  );
}

function Birthday({ birthday, onSaved }: { birthday: LoyaltyOverviewEnabled['birthday']; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (birthday.eligible) {
    return (
      <div className="lx-birthday lx-birthday--on">
        <div className="lx-eyebrow">Tug‘ilgan kun</div>
        <p className="lx-birthday__lead">Tug‘ilgan kuningiz bilan! 🎂</p>
        <p className="lx-tile__hint">{birthday.rewardPoints > 0 ? `Sizga ${birthday.rewardPoints.toLocaleString('ru-RU')} ball sovg‘a mavjud.` : 'Sizga sovg‘a mavjud.'}</p>
      </div>
    );
  }
  if (birthday.birthdaySet) return null;

  const save = async () => {
    if (!value) return;
    setSaving(true);
    setError(null);
    try {
      await setMyBirthday(value);
      onSaved();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lx-birthday">
      <div className="lx-eyebrow">Tug‘ilgan kun</div>
      <p className="lx-tile__hint">Tug‘ilgan kuningizni kiriting — bir marta saqlanadi.</p>
      <div className="lx-birthday__row">
        <input aria-label="Tug‘ilgan kun" max={new Date().toISOString().slice(0, 10)} onChange={(e) => setValue(e.target.value)} type="date" value={value} />
        <button className="button-secondary" disabled={!value || saving} onClick={save} type="button">
          Saqlash
        </button>
      </div>
      {error && <p className="hint-text">{error}</p>}
    </div>
  );
}

function History() {
  const [items, setItems] = useState<LoyaltyHistoryItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyLoyaltyHistory()
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNext(page.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const more = async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await fetchMyLoyaltyHistory(next);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNext(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div>
      <h3 className="lx-subtitle">Tarix</h3>
      {failed && <p className="hint-text">Tarixni yuklab bo‘lmadi</p>}
      {items === null && !failed && <SectionSkeleton height={120} />}
      {items !== null && items.length === 0 && <EmptyState variant="inline" title="Tarix hali mavjud emas" />}
      {items !== null && items.length > 0 && (
        <ul className="lx-history">
          {items.map((item, i) => (
            <li className="lx-history__row" key={`${item.type}-${item.at}-${i}`}>
              <span className="lx-history__icon" aria-hidden="true">{HISTORY_ICON[item.type]}</span>
              <div className="lx-history__main">
                <div>{HISTORY_TITLE[item.type]}</div>
                <div className="lx-tile__hint">{[item.detail, formatDateTime(item.at)].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="lx-history__amount">
                {item.points !== null ? `${item.points > 0 ? '+' : ''}${item.points.toLocaleString('ru-RU')} ball` : item.cashbackMinor !== null ? `+${formatSom(item.cashbackMinor)}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <button className="button-secondary" disabled={loadingMore} onClick={more} type="button">
          {loadingMore ? 'Yuklanmoqda…' : 'Yana'}
        </button>
      )}
    </div>
  );
}
