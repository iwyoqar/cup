import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../../app/EmptyState';
import { SectionSkeleton } from '../../app/SectionSkeleton';
import { toUserMessage } from '../../lib/api/errors';
import { fetchMyLoyaltyHistory, fetchMyLoyaltyOverview, setMyBirthday } from '../../lib/api/loyalty';
import { formatDateTime, formatSom } from '../../lib/format';
import { LoyaltyHistoryItem, LoyaltyOverview, LoyaltyOverviewEnabled } from '../../types/api';
import { LoyaltySection } from './LoyaltySection';
import { buttonSecondary } from '../../app/buttonStyles';
import { cx } from '../../lib/cx';

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
    <section className="flex flex-col gap-3 flex flex-col gap-4">
      <h2 className="font-display text-section leading-[1.2] font-medium">Sodiqlik</h2>

      {level && (
        <div className="flex flex-col gap-3 rounded-lg border-t-4 border-t-[color:var(--lx-color,var(--color-terracotta))] bg-black px-4 py-6 text-cream" style={{ ['--lx-color' as string]: level.color }}>
          <div className="flex items-center gap-3">
            <span className="text-[34px] leading-none" aria-hidden="true">{level.icon}</span>
            <div>
              <div className="text-micro font-bold tracking-[0.1em] text-cream/70 uppercase">Daraja</div>
              <div className="font-display text-title leading-[1.05] font-medium">{level.name}</div>
            </div>
            {data.cashback.enabled && level.cashbackRateBps > 0 && <span className="ml-auto rounded-full border border-cream/50 px-2.5 py-[3px] text-micro font-bold whitespace-nowrap">{(level.cashbackRateBps / 100).toLocaleString('ru-RU')}% keshbek</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-cream/22 [&>span]:block [&>span]:h-full [&>span]:rounded-full [&>span]:bg-terracotta" role="img" aria-label={`XP ${xp.levelXP}`}>
            <span style={{ width: `${barWidth}%` }} />
          </div>
          <div className="flex justify-between gap-3 text-small text-cream/85 tabular-nums">
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

      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
        <div className="min-w-0 rounded-lg bg-cream p-4">
          <div className="text-micro font-bold tracking-[0.1em] text-muted-cream uppercase">Ballar</div>
          <div className="mt-1 font-display text-[26px] leading-[1.1] font-medium tabular-nums [overflow-wrap:anywhere]">{data.points.balance.toLocaleString('ru-RU')}</div>
          <div className="text-small text-muted-cream">jami {data.points.lifetimeEarned.toLocaleString('ru-RU')}</div>
        </div>
        {data.cashback.enabled && (
          <div className="min-w-0 rounded-lg bg-cream p-4">
            <div className="text-micro font-bold tracking-[0.1em] text-muted-cream uppercase">Keshbek</div>
            <div className="mt-1 font-display text-[26px] leading-[1.1] font-medium tabular-nums [overflow-wrap:anywhere]">{formatSom(data.cashback.balance)}</div>
            <div className="text-small text-muted-cream">jami {formatSom(data.cashback.lifetimeEarned)}</div>
          </div>
        )}
      </div>

      {data.streak.enabled && (
        <div className="flex items-center gap-3 rounded-lg border border-line px-4 py-3">
          <span className="text-[28px]" aria-hidden="true">🔥</span>
          <div>
            <div className="font-semibold">{data.streak.current} kun ketma-ket</div>
            <div className="text-small text-muted">Eng yaxshi natija: {data.streak.best} kun</div>
          </div>
        </div>
      )}

      {data.birthday.enabled && <Birthday birthday={data.birthday} onSaved={onBirthdaySaved} />}

      <div>
        <h3 className="mt-0 mb-3 font-display text-lead font-medium">Yutuqlar</h3>
        {data.achievements.length === 0 ? (
          <EmptyState variant="inline" title="Yutuqlar hali mavjud emas" />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {data.achievements.map((a) => (
              <div className={cx('flex min-w-0 flex-col gap-0.5 rounded-md border p-3', a.unlocked ? 'border-transparent bg-cream-soft opacity-100' : 'border-line opacity-72')} key={a.code}>
                <span className="text-[24px]" aria-hidden="true">{a.icon}</span>
                <div className="text-body font-semibold [overflow-wrap:anywhere]">{a.name}</div>
                <div className="text-small text-muted">{a.unlocked ? 'Ochilgan' : `${a.progress.current} / ${a.progress.target}`}</div>
                {!a.unlocked && (
                  <div className="h-1 overflow-hidden rounded-full bg-track [&>span]:block [&>span]:h-full [&>span]:rounded-full [&>span]:bg-terracotta" aria-hidden="true">
                    <span style={{ width: `${a.progress.target > 0 ? Math.min(100, (a.progress.current / a.progress.target) * 100) : 0}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <History />

      <button className={buttonSecondary} onClick={onOpenTransactions} type="button">
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
      <div className="flex flex-col gap-2 rounded-lg border border-transparent bg-cream-soft p-4">
        <div className="text-micro font-bold tracking-[0.1em] text-muted uppercase">Tug‘ilgan kun</div>
        <p className="m-0 font-display text-lead">Tug‘ilgan kuningiz bilan! 🎂</p>
        <p className="text-small text-muted">{birthday.rewardPoints > 0 ? `Sizga ${birthday.rewardPoints.toLocaleString('ru-RU')} ball sovg‘a mavjud.` : 'Sizga sovg‘a mavjud.'}</p>
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
    <div className="flex flex-col gap-2 rounded-lg border border-line p-4">
      <div className="text-micro font-bold tracking-[0.1em] text-muted uppercase">Tug‘ilgan kun</div>
      <p className="text-small text-muted">Tug‘ilgan kuningizni kiriting — bir marta saqlanadi.</p>
      <div className="flex items-center gap-2 [&_input]:min-h-11 [&_input]:min-w-0 [&_input]:flex-1 [&_input]:rounded-sm [&_input]:border [&_input]:border-line-strong [&_input]:px-3 [&_input]:[font:inherit]">
        <input aria-label="Tug‘ilgan kun" max={new Date().toISOString().slice(0, 10)} onChange={(e) => setValue(e.target.value)} type="date" value={value} />
        <button className={buttonSecondary} disabled={!value || saving} onClick={save} type="button">
          Saqlash
        </button>
      </div>
      {error && <p className="text-small leading-[1.45] text-muted">{error}</p>}
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
      <h3 className="mt-0 mb-3 font-display text-lead font-medium">Tarix</h3>
      {failed && <p className="text-small leading-[1.45] text-muted">Tarixni yuklab bo‘lmadi</p>}
      {items === null && !failed && <SectionSkeleton height={120} />}
      {items !== null && items.length === 0 && <EmptyState variant="inline" title="Tarix hali mavjud emas" />}
      {items !== null && items.length > 0 && (
        <ul className="mt-0 mb-3 list-none p-0">
          {items.map((item, i) => (
            <li className="flex items-center gap-3 border-b border-line py-3" key={`${item.type}-${item.at}-${i}`}>
              <span className="grid size-7 flex-none place-items-center rounded-full bg-cream text-[14px]" aria-hidden="true">{HISTORY_ICON[item.type]}</span>
              <div className="min-w-0 flex-1 text-body [overflow-wrap:anywhere]">
                <div>{HISTORY_TITLE[item.type]}</div>
                <div className="text-small text-muted">{[item.detail, formatDateTime(item.at)].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="text-small font-semibold whitespace-nowrap tabular-nums">
                {item.points !== null ? `${item.points > 0 ? '+' : ''}${item.points.toLocaleString('ru-RU')} ball` : item.cashbackMinor !== null ? `+${formatSom(item.cashbackMinor)}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <button className={buttonSecondary} disabled={loadingMore} onClick={more} type="button">
          {loadingMore ? 'Yuklanmoqda…' : 'Yana'}
        </button>
      )}
    </div>
  );
}
