import { useCallback, useEffect, useState } from 'react';
import { CatalogCategory, fetchActiveCategories } from '../lib/adminCatalog';
import {
  AchievementRow,
  CONDITION_LABELS,
  createLoyalty2Achievement,
  fetchLoyalty2Achievements,
  fetchLoyalty2Levels,
  fetchLoyalty2Settings,
  fetchPointsRule,
  Loyalty2Settings,
  LoyaltyLevelRow,
  saveLoyalty2Levels,
  updateLoyalty2Achievement,
  updateLoyalty2Settings,
  updatePointsRule,
} from '../lib/adminLoyalty2';
import { ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { LoyaltySettings } from '../lib/types';
import { Button, cx, ErrorState, LoadingState, tableClass, Toggle } from '../ui';

const message = (err: unknown) => (err instanceof ApiError ? err.backendMessage : 'Request failed.');


function Num({ value, onChange, min = 0, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return <input min={min} onChange={(e) => onChange(Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : min)} step={step} className="w-[110px]" type="number" value={value} />;
}

// Phase 12 — Loyalty 2.0 admin: program switches, membership levels, achievements. Nothing here is hardcoded: every value is
// loaded from and saved to the server, which validates it again (the UI checks are a convenience, never the boundary).
export function Loyalty2Page() {
  const [settings, setSettings] = useState<Loyalty2Settings | null>(null);
  const [draft, setDraft] = useState<Loyalty2Settings | null>(null);
  const [rule, setRule] = useState<LoyaltySettings | null>(null);
  const [ruleDraft, setRuleDraft] = useState<{ earnRate: number; earnUnitAmount: number } | null>(null);
  const [levels, setLevels] = useState<LoyaltyLevelRow[] | null>(null);
  const [achievements, setAchievements] = useState<AchievementRow[] | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    Promise.all([fetchLoyalty2Settings(), fetchLoyalty2Levels(), fetchLoyalty2Achievements(), fetchPointsRule(), fetchActiveCategories()])
      .then(([s, l, a, r, c]) => {
        setSettings(s);
        setDraft(s);
        setLevels(l);
        setAchievements(a);
        setRule(r);
        setRuleDraft({ earnRate: r.earnRate, earnUnitAmount: r.earnUnitAmount });
        setCategories(c);
      })
      .catch((err) => setError(message(err)));
  }, []);

  useEffect(load, [load]);

  if (error && !settings) {
    return (
      <ErrorState message={error} onRetry={load} title="Loyalty 2.0 could not be loaded" />
    );
  }
  if (!settings || !draft || !levels || !achievements || !rule || !ruleDraft) {
    return (
      <div>
        <LoadingState variant="card" />
      </div>
    );
  }

  const run = async (action: () => Promise<void>, okText: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(okText);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const setD = <K extends keyof Loyalty2Settings>(key: K, value: Loyalty2Settings[K]) => setDraft({ ...draft, [key]: value });
  const settingsChanged = JSON.stringify(draft) !== JSON.stringify(settings) || ruleDraft.earnRate !== rule.earnRate || ruleDraft.earnUnitAmount !== rule.earnUnitAmount;

  const saveSettings = () =>
    run(async () => {
      const { accrualStartsAt: _ignored, ...rest } = draft;
      void _ignored;
      if (ruleDraft.earnRate !== rule.earnRate || ruleDraft.earnUnitAmount !== rule.earnUnitAmount) {
        const r = await updatePointsRule({ earnRate: ruleDraft.earnRate, earnUnitAmount: ruleDraft.earnUnitAmount });
        setRule(r);
        setRuleDraft({ earnRate: r.earnRate, earnUnitAmount: r.earnUnitAmount });
      }
      const s = await updateLoyalty2Settings(rest);
      setSettings(s);
      setDraft(s);
    }, 'Settings saved.');

  const setLevel = (code: string, patch: Partial<LoyaltyLevelRow>) => setLevels(levels.map((l) => (l.code === code ? { ...l, ...patch } : l)));

  return (
    <div>
      <p className="text-[13px] leading-snug text-muted">Membership levels, XP, cashback, achievements, streak and birthday. Everything is configuration; nothing is earned until the program is switched on.</p>
      {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      {notice && <p className="text-[13px] font-semibold text-ok">{notice}</p>}

      <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
        <h3 className="m-0">Program</h3>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Loyalty 2.0 enabled</span>
          <Toggle checked={draft.enabled} onChange={(v) => setD('enabled', v)} />
        </div>
        <p className="text-[13px] leading-snug text-muted m-0">
          {settings.accrualStartsAt ? `Cashback and points accrue only for purchases from ${formatDateTime(settings.accrualStartsAt)}. Level and XP use the full purchase history.` : 'The first time the program is enabled, the accrual start is set to that moment (no retroactive cashback).'}
        </p>
        <hr className="m-0 h-px border-0 bg-line" />
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">XP</span>
          <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
            <Num min={0} onChange={(v) => setD('xpRate', v)} value={draft.xpRate} /> XP per <Num min={1} onChange={(v) => setD('xpUnitAmount', v)} value={draft.xpUnitAmount} /> so&apos;m
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Cashback (percent is set per level below)</span>
          <Toggle checked={draft.cashbackEnabled} onChange={(v) => setD('cashbackEnabled', v)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Earn loyalty points on purchases</span>
          <Toggle checked={draft.purchasePointsEnabled} onChange={(v) => setD('purchasePointsEnabled', v)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Points earn rate (existing loyalty rule)</span>
          <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
            <Num min={1} onChange={(v) => setRuleDraft({ ...ruleDraft, earnUnitAmount: v })} value={ruleDraft.earnUnitAmount} /> so&apos;m ={' '}
            <Num min={0} onChange={(v) => setRuleDraft({ ...ruleDraft, earnRate: v })} value={ruleDraft.earnRate} /> point(s) × level multiplier
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Visit streak</span>
          <Toggle checked={draft.streakEnabled} onChange={(v) => setD('streakEnabled', v)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Birthday reward</span>
          <Toggle checked={draft.birthdayEnabled} onChange={(v) => setD('birthdayEnabled', v)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Birthday reward points / window (days)</span>
          <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
            <Num min={0} onChange={(v) => setD('birthdayRewardPoints', v)} value={draft.birthdayRewardPoints} /> <Num min={1} onChange={(v) => setD('birthdayWindowDays', v)} value={draft.birthdayWindowDays} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
          <span className="text-sm font-semibold">Referral (legacy flag, not used — configure the program under Admin › Referrals)</span>
          <Toggle checked={draft.referralEnabled} onChange={(v) => setD('referralEnabled', v)} />
        </div>
        <div>
          <Button disabled={busy || !settingsChanged} onClick={saveSettings} variant="primary">
            {busy ? 'Saving...' : 'Save settings'}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
        <h3 className="m-0">Membership levels</h3>
        <p className="text-[13px] leading-snug text-muted m-0">A customer&apos;s level is derived from lifetime spend (CUP + POS) — it is never assigned by hand. The lowest level must start at 0.</p>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm min-w-[780px]">
            <thead>
              <tr>
                <th className={tableClass.th}>Code</th>
                <th className={tableClass.th}>Name</th>
                <th className={tableClass.th}>Icon</th>
                <th className={tableClass.th}>Color</th>
                <th className={tableClass.th}>From (so&apos;m)</th>
                <th className={tableClass.th}>Cashback %</th>
                <th className={tableClass.th}>Points ×%</th>
                <th className={tableClass.th}>Priority</th>
                <th className={tableClass.th}>Active</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((l) => (
                <tr className={tableClass.tr} key={l.code}>
                  <td className={tableClass.td}>{l.code}</td>
                  <td className={tableClass.td}><input onChange={(e) => setLevel(l.code, { name: e.target.value })} className="w-[100px]" value={l.name} /></td>
                  <td className={tableClass.td}><input onChange={(e) => setLevel(l.code, { icon: e.target.value })} className="w-[50px]" value={l.icon} /></td>
                  <td className={tableClass.td}><input onChange={(e) => setLevel(l.code, { color: e.target.value })} className="w-[90px]" value={l.color} /></td>
                  <td className={tableClass.td}><Num min={0} onChange={(v) => setLevel(l.code, { minLifetimeSpend: v })} value={l.minLifetimeSpend} /></td>
                  <td className={tableClass.td}><Num min={0} onChange={(v) => setLevel(l.code, { cashbackRateBps: Math.round(v * 100) })} step={0.1} value={l.cashbackRateBps / 100} /></td>
                  <td className={tableClass.td}><Num min={0} onChange={(v) => setLevel(l.code, { pointMultiplierPercent: v })} value={l.pointMultiplierPercent} /></td>
                  <td className={tableClass.td}><Toggle checked={l.prioritySupport} onChange={(v) => setLevel(l.code, { prioritySupport: v })} /></td>
                  <td className={tableClass.td}><Toggle checked={l.isActive} onChange={(v) => setLevel(l.code, { isActive: v })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <Button disabled={busy} onClick={() =>
              run(async () => {
                setLevels(await saveLoyalty2Levels(levels.map(({ code, name, color, icon, minLifetimeSpend, cashbackRateBps, pointMultiplierPercent, prioritySupport, isActive }) => ({ code, name, color, icon, minLifetimeSpend, cashbackRateBps, pointMultiplierPercent, prioritySupport, isActive }))));
              }, 'Levels saved.')
            } variant="primary">
            Save levels
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
        <h3 className="m-0">Achievements</h3>
        <p className="text-[13px] leading-snug text-muted m-0">Unlock automatically, once per customer. Coffee achievements need a category before they can be activated.</p>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm min-w-[860px]">
            <thead>
              <tr>
                <th className={tableClass.th}>Achievement</th>
                <th className={tableClass.th}>Condition</th>
                <th className={tableClass.th}>Target</th>
                <th className={tableClass.th}>Extra</th>
                <th className={tableClass.th}>Reward pts</th>
                <th className={tableClass.th}>Active</th>
                <th className={tableClass.th} />
              </tr>
            </thead>
            <tbody>
              {achievements.map((a) => (
                <AchievementRowEditor categories={categories} key={a.id} onSaved={(saved) => setAchievements(achievements.map((x) => (x.id === saved.id ? saved : x)))} row={a} run={run} />
              ))}
            </tbody>
          </table>
        </div>
        <NewAchievement
          categories={categories}
          onCreated={(created) => setAchievements([...achievements, created])}
          run={run}
        />
      </div>
    </div>
  );
}

type Runner = (action: () => Promise<void>, okText: string) => Promise<void>;

function AchievementRowEditor({ row, categories, onSaved, run }: { row: AchievementRow; categories: CatalogCategory[]; onSaved: (a: AchievementRow) => void; run: Runner }) {
  const [d, setD] = useState(row);
  const changed = JSON.stringify(d) !== JSON.stringify(row);
  return (
    <tr>
      <td>
        <input onChange={(e) => setD({ ...d, icon: e.target.value })} className="w-[44px]" value={d.icon} />{' '}
        <input onChange={(e) => setD({ ...d, name: e.target.value })} className="w-[130px]" value={d.name} />
        <div className="text-[13px] leading-snug text-muted">{d.code}</div>
      </td>
      <td>{CONDITION_LABELS[d.conditionType] ?? d.conditionType}</td>
      <td><Num min={1} onChange={(v) => setD({ ...d, conditionValue: v })} value={d.conditionValue} /></td>
      <td>
        {d.conditionType === 'CATEGORY_UNITS' && (
          <select onChange={(e) => setD({ ...d, categoryId: e.target.value || null })} value={d.categoryId ?? ''}>
            <option value="">Choose category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        {d.conditionType === 'MORNING_PURCHASES' && (
          <span>
            before <Num min={1} onChange={(v) => setD({ ...d, conditionParam: v })} value={d.conditionParam ?? 11} />:00
          </span>
        )}
      </td>
      <td><Num min={0} onChange={(v) => setD({ ...d, rewardPoints: v })} value={d.rewardPoints} /></td>
      <td><Toggle checked={d.isActive} onChange={(v) => setD({ ...d, isActive: v })} /></td>
      <td>
        <Button disabled={!changed} onClick={() =>
            run(async () => {
              const saved = await updateLoyalty2Achievement(row.id, { name: d.name, description: d.description, icon: d.icon, conditionType: d.conditionType, conditionValue: d.conditionValue, conditionParam: d.conditionParam, categoryId: d.categoryId, rewardPoints: d.rewardPoints, isActive: d.isActive, sortOrder: d.sortOrder });
              setD(saved);
              onSaved(saved);
            }, `${d.name} saved.`)
          } variant="secondary">
          Save
        </Button>
      </td>
    </tr>
  );
}

function NewAchievement({ categories, onCreated, run }: { categories: CatalogCategory[]; onCreated: (a: AchievementRow) => void; run: Runner }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ code: '', name: '', description: '', icon: '🏅', conditionType: 'TOTAL_PURCHASES', conditionValue: 1, conditionParam: null as number | null, categoryId: null as string | null, rewardPoints: 0, isActive: false });
  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)} variant="secondary">
          Add achievement
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium m-0">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
        <span className="text-sm font-semibold">Code / name / icon</span>
        <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
          <input onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} placeholder="CODE" className="w-[130px]" value={d.code} />
          <input onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Name" className="w-[150px]" value={d.name} />
          <input onChange={(e) => setD({ ...d, icon: e.target.value })} className="w-[50px]" value={d.icon} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
        <span className="text-sm font-semibold">Description</span>
        <input onChange={(e) => setD({ ...d, description: e.target.value })} className="w-[320px]" value={d.description} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
        <span className="text-sm font-semibold">Condition</span>
        <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
          <select onChange={(e) => setD({ ...d, conditionType: e.target.value })} value={d.conditionType}>
            {Object.entries(CONDITION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          ≥ <Num min={1} onChange={(v) => setD({ ...d, conditionValue: v })} value={d.conditionValue} />
          {d.conditionType === 'CATEGORY_UNITS' && (
            <select onChange={(e) => setD({ ...d, categoryId: e.target.value || null })} value={d.categoryId ?? ''}>
              <option value="">Choose category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {d.conditionType === 'MORNING_PURCHASES' && <Num min={1} onChange={(v) => setD({ ...d, conditionParam: v })} value={d.conditionParam ?? 11} />}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
        <span className="text-sm font-semibold">Reward points / active</span>
        <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
          <Num min={0} onChange={(v) => setD({ ...d, rewardPoints: v })} value={d.rewardPoints} /> <Toggle checked={d.isActive} onChange={(v) => setD({ ...d, isActive: v })} />
        </div>
      </div>
      <div>
        <Button onClick={() =>
            run(async () => {
              const created = await createLoyalty2Achievement({ ...d, sortOrder: 100 });
              onCreated(created);
              setOpen(false);
            }, 'Achievement created.')
          } variant="primary">
          Create
        </Button>{' '}
        <Button onClick={() => setOpen(false)} variant="secondary">
          Cancel
        </Button>
      </div>
    </div>
  );
}
